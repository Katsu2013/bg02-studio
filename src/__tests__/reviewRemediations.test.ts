import { afterEach, describe, expect, it } from "vitest";
import { Bg02Client, Bg02ConnectError } from "../ble/bg02Client";
import { encodeCmdPayload } from "../ble/frameCodec";
import type {
  WebBluetoothApi,
  WebBluetoothCharacteristic,
  WebBluetoothDevice,
  WebBluetoothGattServer,
  WebBluetoothService,
} from "../ble/webBluetooth.types";
import {
  BLE_MODULE,
  BLE_SUB_CMD,
  MYWATCH_NOTIFY1_UUID,
  MYWATCH_NOTIFY2_UUID,
  MYWATCH_SERVICE_UUID,
  MYWATCH_WRITE_UUID,
} from "../constants/ble";
import { enDictionary } from "../i18n/en";
import { jaDictionary } from "../i18n/ja";
import {
  createDefaultTextOverlay,
  createDefaultTransform,
  hasPublishableBadgeContent,
} from "../imaging/badgeCompositor";
import { AppStore } from "../state/appStore";
import {
  shouldCommitEditorProceedToSend,
  verifyPreparedSendConsistency,
  type PendingPrepareTarget,
} from "../state/sendSession";

class MockGattChar extends EventTarget implements WebBluetoothCharacteristic {
  public readonly uuid: string;
  public readonly properties = {
    write: true,
    writeWithoutResponse: true,
    notify: true,
  };
  public value: DataView | null = null;
  public readonly writes: Uint8Array[] = [];
  public onWrite?: (bytes: Uint8Array) => void;

  public constructor(uuid: string) {
    super();
    this.uuid = uuid;
  }

  public async readValue(): Promise<DataView> {
    return new DataView(new ArrayBuffer(0));
  }

  public async writeValueWithResponse(value: BufferSource): Promise<void> {
    const view =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(view);
    this.writes.push(copy);
    this.onWrite?.(copy);
  }

  public async writeValueWithoutResponse(value: BufferSource): Promise<void> {
    await this.writeValueWithResponse(value);
  }

  public async writeValue(value: BufferSource): Promise<void> {
    await this.writeValueWithResponse(value);
  }

  public async startNotifications(): Promise<WebBluetoothCharacteristic> {
    return this;
  }

  public async stopNotifications(): Promise<WebBluetoothCharacteristic> {
    return this;
  }

  public emitNotify(bytes: Uint8Array): void {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

function encodeAckFrame(cmdId: number, cmdKey: number, frameLen: number): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  out[0] = 0xdc;
  out[1] = 0x00;
  out[2] = 0x05;
  out[3] = cmdId & 0xff;
  out[4] = cmdKey & 0xff;
  dv.setUint16(5, frameLen, false);
  out[7] = 0x01;
  return out;
}

function buildDialStatusFrame(code: number): Uint8Array {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setUint32(0, code >>> 0, false);
  return encodeCmdPayload(BLE_MODULE.DIAL_CONTROL, BLE_SUB_CMD.DIAL_RESPONSE, p);
}

class MockBadgeDevice extends EventTarget implements WebBluetoothDevice {
  public readonly id: string;
  public readonly name: string;
  public readonly gatt: WebBluetoothGattServer;
  public readonly writeChar: MockGattChar;
  public readonly notify1: MockGattChar;
  private linked = false;

  public constructor(id: string, name: string, failGattConnect = false) {
    super();
    this.id = id;
    this.name = name;
    this.writeChar = new MockGattChar(MYWATCH_WRITE_UUID);
    this.notify1 = new MockGattChar(MYWATCH_NOTIFY1_UUID);
    const notify2 = new MockGattChar(MYWATCH_NOTIFY2_UUID);

    this.writeChar.onWrite = (pkt) => {
      if (pkt.length < 8 || pkt[0] !== 0xcd) return;
      const cmdId = pkt[3];
      const cmdKey = pkt[5];
      setTimeout(() => {
        if (!this.linked) return;
        this.notify1.emitNotify(encodeAckFrame(cmdId, cmdKey, pkt.length));
        if (cmdId === BLE_MODULE.DIAL_TRANSFER && cmdKey === BLE_SUB_CMD.DIAL_START) {
          this.notify1.emitNotify(buildDialStatusFrame(1000));
        } else if (cmdId === BLE_MODULE.DIAL_TRANSFER && cmdKey === BLE_SUB_CMD.DIAL_CHUNK) {
          const seq = (pkt[8] << 8) | pkt[9];
          this.notify1.emitNotify(buildDialStatusFrame(1000 + seq));
        } else if (cmdId === BLE_MODULE.DIAL_TRANSFER && cmdKey === BLE_SUB_CMD.DIAL_FINISH) {
          this.notify1.emitNotify(buildDialStatusFrame(2));
        }
      }, 2);
    };

    const service: WebBluetoothService = {
      uuid: MYWATCH_SERVICE_UUID,
      getCharacteristic: async (uuid: string | number) => {
        if (uuid === MYWATCH_WRITE_UUID) return this.writeChar;
        if (uuid === MYWATCH_NOTIFY1_UUID) return this.notify1;
        if (uuid === MYWATCH_NOTIFY2_UUID) return notify2;
        throw new Error(`Unexpected characteristic ${uuid}`);
      },
    };

    const owner = this;
    this.gatt = {
      device: this,
      get connected() {
        return owner.linked;
      },
      connect: async () => {
        if (failGattConnect) {
          throw new DOMException("GATT link failure", "NetworkError");
        }
        owner.linked = true;
        return this.gatt;
      },
      disconnect: () => {
        if (owner.linked) {
          owner.linked = false;
          owner.dispatchEvent(new Event("gattserverdisconnected"));
        }
      },
      getPrimaryService: async () => service,
    };
  }

  public countUploadFrames(): { starts: number; chunks: number; finishes: number } {
    let starts = 0;
    let chunks = 0;
    let finishes = 0;
    for (const w of this.writeChar.writes) {
      if (w.length >= 6 && w[0] === 0xcd && w[3] === BLE_MODULE.DIAL_TRANSFER) {
        if (w[5] === BLE_SUB_CMD.DIAL_START) starts += 1;
        if (w[5] === BLE_SUB_CMD.DIAL_CHUNK) chunks += 1;
        if (w[5] === BLE_SUB_CMD.DIAL_FINISH) finishes += 1;
      }
    }
    return { starts, chunks, finishes };
  }
}

function stubNavigatorBluetooth(api: WebBluetoothApi | undefined): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { bluetooth: api },
  });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  };
}

function makeSampleJpegBytes(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0xf0, 0x00, 0xf0, 0x01, 0x11, 0x22, 0x33, 0xff, 0xd9,
  ]);
}

describe("Codex post-review remediations regression suite", () => {
  let restoreNav: (() => void) | null = null;

  afterEach(() => {
    restoreNav?.();
    restoreNav = null;
  });

  it("P1: aborts delayed JPEG encode when target badge switches before encode finishes", async () => {
    const devA = new MockBadgeDevice("badge-a", "ライブ用");
    const devB = new MockBadgeDevice("badge-b", "バッグ用");
    const permitted = [devA, devB];
    let pickNext: MockBadgeDevice = devA;

    restoreNav = stubNavigatorBluetooth({
      getDevices: async () => permitted,
      requestDevice: async () => pickNext,
    });

    const client = new Bg02Client();
    await client.connect();
    expect(client.activeId).toBe("badge-a");

    const pending: PendingPrepareTarget = {
      targetDeviceId: "badge-a",
      targetDeviceName: "ライブ用",
      draftGeneration: 3,
      bleSessionGeneration: client.currentSessionGeneration,
      prepareToken: 1,
    };

    // Simulate slow JPEG encode while user connects Badge B ("バッグ用")
    let resolveDelayedEncode!: (bytes: Uint8Array) => void;
    const delayedEncode = new Promise<Uint8Array>((resolve) => {
      resolveDelayedEncode = resolve;
    });

    pickNext = devB;
    await client.connect();
    expect(client.activeId).toBe("badge-b");

    resolveDelayedEncode(makeSampleJpegBytes());
    const encoded = await delayedEncode;

    const consistency = verifyPreparedSendConsistency({
      pending,
      currentPrepareToken: 1,
      activeScreen: "send",
      currentDraftGeneration: 3,
      currentSelectedTargetId: "badge-b",
      liveActiveDeviceId: client.activeId,
      isBleConnected: client.isConnected,
      currentBleSessionGeneration: client.currentSessionGeneration,
    });

    expect(consistency).toEqual({ ok: false, reason: "target_changed" });
    expect(devB.countUploadFrames()).toEqual({ starts: 0, chunks: 0, finishes: 0 });
    expect(devA.countUploadFrames()).toEqual({ starts: 0, chunks: 0, finishes: 0 });

    // Badge B receives an upload ONLY when user explicitly initiates upload against Badge B
    const res = await client.uploadDialImage(encoded, { expectedDeviceId: "badge-b" });
    expect(res.deviceId).toBe("badge-b");
    expect(devB.countUploadFrames()).toEqual({ starts: 1, chunks: 1, finishes: 1 });
  });

  it("P1: covers all verifyPreparedSendConsistency abort reasons and valid match", () => {
    const base: PendingPrepareTarget = {
      targetDeviceId: "badge-a",
      targetDeviceName: "ライブ用",
      draftGeneration: 5,
      bleSessionGeneration: 2,
      prepareToken: 7,
    };

    expect(
      verifyPreparedSendConsistency({
        pending: base,
        currentPrepareToken: 7,
        activeScreen: "send",
        currentDraftGeneration: 5,
        currentSelectedTargetId: "badge-a",
        liveActiveDeviceId: "badge-a",
        isBleConnected: true,
        currentBleSessionGeneration: 2,
      })
    ).toEqual({ ok: true });

    expect(
      verifyPreparedSendConsistency({
        pending: base,
        currentPrepareToken: 8,
        activeScreen: "send",
        currentDraftGeneration: 5,
        currentSelectedTargetId: "badge-a",
        liveActiveDeviceId: "badge-a",
        isBleConnected: true,
        currentBleSessionGeneration: 2,
      })
    ).toEqual({ ok: false, reason: "superseded" });

    expect(
      verifyPreparedSendConsistency({
        pending: base,
        currentPrepareToken: 7,
        activeScreen: "editor",
        currentDraftGeneration: 5,
        currentSelectedTargetId: "badge-a",
        liveActiveDeviceId: "badge-a",
        isBleConnected: true,
        currentBleSessionGeneration: 2,
      })
    ).toEqual({ ok: false, reason: "screen_left" });

    expect(
      verifyPreparedSendConsistency({
        pending: base,
        currentPrepareToken: 7,
        activeScreen: "send",
        currentDraftGeneration: 6,
        currentSelectedTargetId: "badge-a",
        liveActiveDeviceId: "badge-a",
        isBleConnected: true,
        currentBleSessionGeneration: 2,
      })
    ).toEqual({ ok: false, reason: "draft_changed" });

    expect(
      verifyPreparedSendConsistency({
        pending: base,
        currentPrepareToken: 7,
        activeScreen: "send",
        currentDraftGeneration: 5,
        currentSelectedTargetId: "badge-a",
        liveActiveDeviceId: null,
        isBleConnected: false,
        currentBleSessionGeneration: 2,
      })
    ).toEqual({ ok: false, reason: "connection_changed" });

    expect(
      verifyPreparedSendConsistency({
        pending: base,
        currentPrepareToken: 7,
        activeScreen: "send",
        currentDraftGeneration: 5,
        currentSelectedTargetId: "badge-a",
        liveActiveDeviceId: "badge-a",
        isBleConnected: true,
        currentBleSessionGeneration: 3,
      })
    ).toEqual({ ok: false, reason: "connection_changed" });
  });

  it("P2: classifies connect() failures into unsupported, permission_unavailable, and gatt_failed", async () => {
    // 1. Web Bluetooth unavailable
    restoreNav = stubNavigatorBluetooth(undefined);
    const noBtClient = new Bg02Client();
    await expect(noBtClient.connect()).rejects.toMatchObject({
      name: "Bg02ConnectError",
      reason: "unsupported",
    });

    // 2. Saved badge permission unavailable (getDevices() empty with reuseDevice: true)
    restoreNav();
    restoreNav = stubNavigatorBluetooth({
      getDevices: async () => [],
      requestDevice: async () => {
        throw new Error("should not call chooser automatically");
      },
    });
    const unpermittedClient = new Bg02Client();
    let caughtPerm: unknown = null;
    try {
      await unpermittedClient.connect({ deviceId: "saved-badge-1", reuseDevice: true });
    } catch (err) {
      caughtPerm = err;
    }
    expect(caughtPerm).toBeInstanceOf(Bg02ConnectError);
    expect((caughtPerm as Bg02ConnectError).reason).toBe("permission_unavailable");

    // 3. GATT connect fails due to out-of-range / power off
    const unreachableDev = new MockBadgeDevice("dead-badge", "BG02", true);
    restoreNav();
    restoreNav = stubNavigatorBluetooth({
      getDevices: async () => [unreachableDev],
      requestDevice: async () => unreachableDev,
    });
    const gattClient = new Bg02Client();
    let caughtGatt: unknown = null;
    try {
      await gattClient.connect({ deviceId: "dead-badge" });
    } catch (err) {
      caughtGatt = err;
    }
    expect(caughtGatt).toBeInstanceOf(Bg02ConnectError);
    expect((caughtGatt as Bg02ConnectError).reason).toBe("gatt_failed");
  });

  it("UI state & copy invariants: background default parity, text-editor separation, Send cleanliness, Detail diagnostics", () => {
    // Default transform background matches #0f172a color input
    expect(createDefaultTransform().backgroundColor).toBe("#0f172a");

    // Closing text edit keeps text content enabled; removing text clears publishability
    const withText = { ...createDefaultTextOverlay(), enabled: true, text: "KATSU" };
    expect(hasPublishableBadgeContent(false, withText)).toBe(true);
    const removedText = createDefaultTextOverlay();
    expect(hasPublishableBadgeContent(false, removedText)).toBe(false);

    // AppStore exposes preparingSend, textEditorOpen, and lastCompletedTransfer
    const store = new AppStore();
    expect(store.snapshot.preparingSend).toBeNull();
    expect(store.snapshot.textEditorOpen).toBe(false);
    expect(store.snapshot.lastCompletedTransfer).toBeNull();

    // Send & Home copy do not leak slot 5538, Checksum, or offline Bluetooth essay
    for (const dict of [jaDictionary, enDictionary]) {
      const sendVisibleCopy = [
        dict.send.stateCompletedTitle,
        dict.send.replaceCustomSlotNote,
        dict.send.targetCardHeading,
        dict.send.btnBackEdit,
      ].join("\n");
      expect(sendVisibleCopy).not.toMatch(/5538|checksum|チェックサム/i);
      expect(dict.home.sampleCaption).not.toMatch(/Bluetooth|オフライン/i);

      // Fixed slot 5538 and Checksum diagnostics reside in Device Details
      expect(dict.detail.valueCustomSlotFixed).toContain("5538");
      expect(dict.detail.valueLastTransferMeta).toContain("{checksum}");
    }
  });

  it("Remaining P1 & First-Time UX: guards Editor->Send delayed transition and attaches device metadata on failed chooser connect with zero upload frames", async () => {
    expect(
      shouldCommitEditorProceedToSend({
        expectedSeq: 3,
        currentSeq: 3,
        activeScreen: "editor",
      })
    ).toBe(true);
    expect(
      shouldCommitEditorProceedToSend({
        expectedSeq: 3,
        currentSeq: 4,
        activeScreen: "editor",
      })
    ).toBe(false);
    expect(
      shouldCommitEditorProceedToSend({
        expectedSeq: 3,
        currentSeq: 3,
        activeScreen: "home",
      })
    ).toBe(false);

    // Chooser selects a reachable-later device whose GATT connect fails -> carries deviceId/name and sends 0 upload frames
    const chosenBadDev = new MockBadgeDevice("badge-picker-fail", "BG02-Bad", true);
    restoreNav = stubNavigatorBluetooth({
      getDevices: async () => [],
      requestDevice: async () => chosenBadDev,
    });

    const client = new Bg02Client();
    let caught: unknown = null;
    try {
      await client.connect({ reuseDevice: false });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Bg02ConnectError);
    expect((caught as Bg02ConnectError).reason).toBe("gatt_failed");
    expect((caught as Bg02ConnectError).deviceId).toBe("badge-picker-fail");
    expect((caught as Bg02ConnectError).deviceName).toBe("BG02-Bad");
    expect(client.hasLiveDevice("badge-picker-fail")).toBe(true);
    expect(chosenBadDev.writeChar.writes.length).toBe(0);

    // Home/Badges/Send recovery & onboarding keys stay in exact parity across JA & EN
    expect(jaDictionary.home.btnConnectBadge.length).toBeGreaterThan(0);
    expect(enDictionary.home.btnConnectBadge.length).toBeGreaterThan(0);
    expect(jaDictionary.badges.btnRetryAdd.length).toBeGreaterThan(0);
    expect(enDictionary.badges.btnRetryAdd.length).toBeGreaterThan(0);
    expect(jaDictionary.send.stateReconnectingTitle).toContain("{name}");
    expect(enDictionary.send.stateReconnectingTitle).toContain("{name}");
  });
});
