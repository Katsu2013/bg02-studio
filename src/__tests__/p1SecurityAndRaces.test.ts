import { afterEach, describe, expect, it, vi } from "vitest";
import { Bg02Client } from "../ble/bg02Client";
import { encodeCmdPayload } from "../ble/frameCodec";
import { Bg02ProtocolError, type ClockDialInfo, type ConnectedDeviceMetadata } from "../ble/types";
import type {
  WebBluetoothApi,
  WebBluetoothCharacteristic,
  WebBluetoothDevice,
  WebBluetoothGattServer,
  WebBluetoothService,
} from "../ble/webBluetooth.types";
import { BleWriteQueue } from "../ble/writeQueue";
import {
  BLE_MODULE,
  BLE_SUB_CMD,
  DIAL_STEP_RESPONSE_TIMEOUT_MS,
  MYWATCH_NOTIFY1_UUID,
  MYWATCH_NOTIFY2_UUID,
  MYWATCH_SERVICE_UUID,
  MYWATCH_WRITE_UUID,
} from "../constants/ble";
import { createDefaultTextOverlay, hasPublishableBadgeContent } from "../imaging/badgeCompositor";
import { assessDeviceUploadSupport, inspectJpeg } from "../imaging/jpegInspector";
import type { CompositedBadgeResult } from "../imaging/types";
import {
  addDeletedDeviceId,
  clearDeletedDeviceId,
  createDefaultReconnectPrefs,
  pickStartupReconnectTarget,
  resolveUploadReconnectPlan,
  upsertDeviceProfile,
} from "../state/deviceRegistry";
import { buildScopedCachePrefix, verifyScopedServiceWorkerReady } from "../state/offlineStatus";
import {
  evaluateUploadGate,
  reconcilePopStateSendTarget,
  resolveSendTargetView,
} from "../state/sendSession";

class SimCharacteristic extends EventTarget implements WebBluetoothCharacteristic {
  public readonly uuid: string;
  public readonly properties = {
    write: true,
    writeWithoutResponse: true,
    notify: true,
  };
  public value: DataView | null = null;
  public readonly writes: Uint8Array[] = [];
  public customWriteHandler?: (bytes: Uint8Array) => Promise<void>;

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
    if (this.customWriteHandler) {
      await this.customWriteHandler(copy);
    }
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

class SimBg02Device extends EventTarget implements WebBluetoothDevice {
  public readonly id: string;
  public readonly name?: string;
  public readonly gatt: WebBluetoothGattServer;
  public readonly writeChar: SimCharacteristic;
  public readonly notify1: SimCharacteristic;
  private linked = false;

  public constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
    this.writeChar = new SimCharacteristic(MYWATCH_WRITE_UUID);
    this.notify1 = new SimCharacteristic(MYWATCH_NOTIFY1_UUID);
    const notify2 = new SimCharacteristic(MYWATCH_NOTIFY2_UUID);

    const service: WebBluetoothService = {
      uuid: MYWATCH_SERVICE_UUID,
      getCharacteristic: async (uuid: string | number) => {
        if (uuid === MYWATCH_WRITE_UUID) return this.writeChar;
        if (uuid === MYWATCH_NOTIFY1_UUID) return this.notify1;
        if (uuid === MYWATCH_NOTIFY2_UUID) return notify2;
        throw new Error(`Unexpected char: ${uuid}`);
      },
    };

    const owner = this;
    this.gatt = {
      device: this,
      get connected() {
        return owner.linked;
      },
      connect: async () => {
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

  public simulateDrop(): void {
    this.linked = false;
    this.dispatchEvent(new Event("gattserverdisconnected"));
  }

  public countWatchThemeFrames(): { starts: number; chunks: number; finishes: number } {
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

function buildDialStatusNotify(code: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, code >>> 0, false);
  return encodeCmdPayload(BLE_MODULE.DIAL_CONTROL, BLE_SUB_CMD.DIAL_RESPONSE, payload);
}

function makeSampleBaselineJpeg(width = 240, height = 240, fillByte = 0x42): Uint8Array {
  // Valid SOI + APP0 + SOF0 + padded data + EOI (~320 bytes to force multiple small chunks in test)
  const header = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01,
  ];
  const filler = new Array<number>(280).fill(fillByte);
  return new Uint8Array([...header, ...filler, 0xff, 0xd9]);
}

function makeDialInfo(overrides: Partial<ClockDialInfo> = {}): ClockDialInfo {
  return {
    screenType: 1,
    shape: "round",
    grade: 0,
    width: 240,
    height: 240,
    mchModel: "K66",
    mainModel: "LJ733",
    config: 8,
    algorithm: 4,
    algorithmName: "JPEG (4)",
    versionCode: 0,
    customer: "JQ001",
    pictureNums: 1,
    watchThemeVersion: 9,
    watchThemeShortPkgLength: 5000,
    thumbWidth: 120,
    thumbHeight: 120,
    ...overrides,
  };
}

function makeOutputFromJpeg(jpegBytes: Uint8Array, draftGeneration: number): CompositedBadgeResult {
  return {
    jpegBytes,
    byteLength: jpegBytes.length,
    usedQuality: 0.9,
    exceedsTarget: false,
    inspection: inspectJpeg(jpegBytes),
    exportCanvas: {} as HTMLCanvasElement,
    draftGeneration,
  };
}

describe("P1/P2 verification on simulated 2-device BG02 environment", () => {
  let restoreNav: (() => void) | null = null;

  afterEach(() => {
    vi.useRealTimers();
    restoreNav?.();
    restoreNav = null;
  });

  it("P1-1: prevents target mismatch when connected to A and cancelling picker / selecting C", async () => {
    const devA = new SimBg02Device("dev-a", "BG02-A");
    const devC = new SimBg02Device("dev-c", "Live Badge C");
    let pickerCall = 0;

    restoreNav = stubNavigatorBluetooth({
      requestDevice: vi.fn(async () => {
        pickerCall += 1;
        if (pickerCall === 1) return devA;
        throw new Error("User cancelled the requestDevice() chooser.");
      }),
    });

    const client = new Bg02Client();
    const metaA: ConnectedDeviceMetadata = {
      ...(await client.connect()),
      dialInfo: makeDialInfo(),
      freeStorageBytes: 40_000,
      standardInfo: { batteryPercent: 78 },
    };

    const saved = upsertDeviceProfile(
      upsertDeviceProfile([], { id: "dev-a", advertisedName: "BG02-A", batteryPercent: 78 }),
      { id: "dev-c", advertisedName: "Live Badge C", batteryPercent: 30 }
    );

    // User attempts chooser for new/unpermitted C -> picker cancels
    await expect(client.connect()).rejects.toThrow("User cancelled");
    // Connection to A remains intact
    expect(client.isConnected).toBe(true);
    expect(client.activeId).toBe("dev-a");

    // Even if UI focused C ("Live Badge C"), resolveSendTargetView refuses to expose A's battery under C's label
    const targetCView = resolveSendTargetView({
      selectedSendTargetId: "dev-c",
      savedDevices: saved,
      clientConnected: client.isConnected,
      clientActiveId: client.activeId,
      connectedMetadata: metaA,
    });
    expect(targetCView.targetDisplayName).toBe("Live Badge C #2");
    expect(targetCView.isTargetConnected).toBe(false);
    expect(targetCView.isDifferentDeviceConnected).toBe(true);
    expect(targetCView.liveMetadata).toBeNull();

    const jpeg = makeSampleBaselineJpeg();
    const gate = evaluateUploadGate({
      hasSourceImage: true,
      textOverlay: createDefaultTextOverlay(),
      targetView: targetCView,
      latestOutput: makeOutputFromJpeg(jpeg, 1),
      draftGeneration: 1,
    });
    expect(gate).toEqual({ allowed: false, reason: "target_not_connected" });

    // Low-level client guard also throws if caller mistakenly asks to write to C while A is connected
    await expect(client.uploadDialImage(jpeg, { expectedDeviceId: "dev-c" })).rejects.toThrow(
      /Target mismatch/
    );
    expect(devA.countWatchThemeFrames()).toEqual({ starts: 0, chunks: 0, finishes: 0 });
    expect(devC.countWatchThemeFrames()).toEqual({ starts: 0, chunks: 0, finishes: 0 });
  });

  it("P1-1b: invalidates stale send target on history navigation after switching to B, emitting 0 writes to A", async () => {
    const devA = new SimBg02Device("dev-a", "BG02-A");
    const devB = new SimBg02Device("dev-b", "BG02-B");
    let nextPick: SimBg02Device = devA;

    restoreNav = stubNavigatorBluetooth({
      requestDevice: vi.fn(async () => nextPick),
    });

    const client = new Bg02Client();
    await client.connect(); // A connected when entering Editor (context = dev-a)

    // User backs out to Home and connects B instead
    nextPick = devB;
    const metaB: ConnectedDeviceMetadata = {
      ...(await client.connect()),
      dialInfo: makeDialInfo(),
      freeStorageBytes: 50_000,
      standardInfo: { batteryPercent: 85 },
    };
    expect(client.activeId).toBe("dev-b");

    // User navigates forward in browser history back to old Edit entry created under dev-a
    const reconciled = reconcilePopStateSendTarget({
      routeContextDeviceId: "dev-a",
      currentSelectedTargetId: "dev-a",
      clientConnected: client.isConnected,
      clientActiveId: client.activeId,
    });
    expect(reconciled).toEqual({ nextSelectedTargetId: null, targetDriftDetected: true });

    const profiles = upsertDeviceProfile(
      upsertDeviceProfile([], { id: "dev-a", advertisedName: "BG02-A" }),
      { id: "dev-b", advertisedName: "BG02-B" }
    );
    const viewAfterDrift = resolveSendTargetView({
      selectedSendTargetId: reconciled.nextSelectedTargetId,
      savedDevices: profiles,
      clientConnected: client.isConnected,
      clientActiveId: client.activeId,
      connectedMetadata: metaB,
    });
    const jpeg = makeSampleBaselineJpeg();
    expect(
      evaluateUploadGate({
        hasSourceImage: true,
        textOverlay: createDefaultTextOverlay(),
        targetView: viewAfterDrift,
        latestOutput: makeOutputFromJpeg(jpeg, 2),
        draftGeneration: 2,
      })
    ).toEqual({ allowed: false, reason: "target_unselected" });

    // Once user explicitly confirms dev-b as destination, only dev-b receives frames
    const confirmedBView = resolveSendTargetView({
      selectedSendTargetId: "dev-b",
      savedDevices: profiles,
      clientConnected: client.isConnected,
      clientActiveId: client.activeId,
      connectedMetadata: metaB,
    });
    const gateB = evaluateUploadGate({
      hasSourceImage: true,
      textOverlay: createDefaultTextOverlay(),
      targetView: confirmedBView,
      latestOutput: makeOutputFromJpeg(jpeg, 2),
      draftGeneration: 2,
    });
    expect(gateB.allowed).toBe(true);
    if (gateB.allowed) {
      const uploadPromise = client.uploadDialImage(gateB.frozenSession.jpegBytes, {
        expectedDeviceId: gateB.frozenSession.targetDeviceId,
        chunkSize: 1000,
      });
      await new Promise((r) => setTimeout(r, 40));
      devB.notify1.emitNotify(buildDialStatusNotify(1000));
      await new Promise((r) => setTimeout(r, 40));
      devB.notify1.emitNotify(buildDialStatusNotify(1001));
      await new Promise((r) => setTimeout(r, 40));
      devB.notify1.emitNotify(buildDialStatusNotify(2));
      const res = await uploadPromise;
      expect(res.deviceId).toBe("dev-b");
    }

    expect(devA.countWatchThemeFrames()).toEqual({ starts: 0, chunks: 0, finishes: 0 });
    expect(devB.countWatchThemeFrames()).toEqual({ starts: 1, chunks: 1, finishes: 1 });
  });

  it("P1-2: ignores premature code=2 on Start/Chunk wait and requires full chunk + Finish ACK", async () => {
    vi.useFakeTimers();
    const dev = new SimBg02Device("dev-premature", "BG02");
    restoreNav = stubNavigatorBluetooth({ requestDevice: vi.fn(async () => dev) });

    const client = new Bg02Client();
    const connectP = client.connect();
    await vi.runAllTimersAsync();
    await connectP;

    const jpeg = makeSampleBaselineJpeg(240, 240);
    // chunkSize 120 forces 3 chunks for ~306B wrapped payload
    const stages: Array<string | undefined> = [];
    const uploadP = client.uploadDialImage(jpeg, {
      expectedDeviceId: "dev-premature",
      chunkSize: 120,
      onProgress: (p) => stages.push(p.stage),
    });

    // Wait for DIAL_START TX
    await vi.advanceTimersByTimeAsync(100);
    expect(dev.countWatchThemeFrames()).toEqual({ starts: 1, chunks: 0, finishes: 0 });

    // Simulate stale/erroneous FINISH_OK (code 2) right after DIAL_START
    let resolvedEarly = false;
    void uploadP.then(() => {
      resolvedEarly = true;
    });
    dev.notify1.emitNotify(buildDialStatusNotify(2));
    await vi.advanceTimersByTimeAsync(50);
    expect(resolvedEarly).toBe(false);
    expect(dev.countWatchThemeFrames()).toEqual({ starts: 1, chunks: 0, finishes: 0 });

    // Now simulate Start ACK (1000) -> Chunk 1 sent, then premature code=2 BEFORE Chunks 2 & 3!
    dev.notify1.emitNotify(buildDialStatusNotify(1000));
    await vi.advanceTimersByTimeAsync(100);
    dev.notify1.emitNotify(buildDialStatusNotify(1001));
    await vi.advanceTimersByTimeAsync(100);
    dev.notify1.emitNotify(buildDialStatusNotify(2)); // Still sending chunks (#2 pending) -> must ignore!
    await vi.advanceTimersByTimeAsync(50);
    expect(resolvedEarly).toBe(false);

    // Ack Chunk #2 and Chunk #3 -> triggers DIAL_FINISH and enters awaiting_finish
    dev.notify1.emitNotify(buildDialStatusNotify(1002));
    await vi.advanceTimersByTimeAsync(100);
    dev.notify1.emitNotify(buildDialStatusNotify(1003));
    await vi.advanceTimersByTimeAsync(100);
    expect(stages).toContain("awaiting_finish");
    expect(dev.countWatchThemeFrames()).toEqual({ starts: 1, chunks: 3, finishes: 1 });
    expect(resolvedEarly).toBe(false);

    // Genuine Finish code=2 AFTER DIAL_FINISH completes upload cleanly
    dev.notify1.emitNotify(buildDialStatusNotify(2));
    await vi.advanceTimersByTimeAsync(20);
    const res = await uploadP;
    expect(res.deviceId).toBe("dev-premature");

    // Verify if Start ONLY ever returns code=2 without 1000, upload fails on Start timeout
    const hungUpload = client.uploadDialImage(jpeg, { expectedDeviceId: "dev-premature" });
    const hungErrP = hungUpload.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    dev.notify1.emitNotify(buildDialStatusNotify(2));
    await vi.advanceTimersByTimeAsync(DIAL_STEP_RESPONSE_TIMEOUT_MS + 200);
    const err = await hungErrP;
    expect(err).toBeInstanceOf(Bg02ProtocolError);
  });

  it("P1-3: isolates write queue and client sessions across hung writes, disconnect, and reconnect to B", async () => {
    const devA = new SimBg02Device("dev-a", "BG02-A");
    const devB = new SimBg02Device("dev-b", "BG02-B");
    let releaseHungWrite: () => void = () => undefined;
    devA.writeChar.customWriteHandler = async (bytes) => {
      if (bytes[0] === 0xcd && bytes[3] === BLE_MODULE.DIAL_TRANSFER) {
        await new Promise<void>((res) => {
          releaseHungWrite = res;
        });
      }
    };

    let nextPick: SimBg02Device = devA;
    restoreNav = stubNavigatorBluetooth({ requestDevice: vi.fn(async () => nextPick) });

    const client = new Bg02Client();
    await client.connect();

    const jpeg = makeSampleBaselineJpeg();
    const uploadA = client.uploadDialImage(jpeg, { expectedDeviceId: "dev-a" });
    const uploadAErr = uploadA.catch((e: unknown) => e);

    // Let DIAL_START enter the hung GATT write on devA
    await new Promise((r) => setTimeout(r, 30));

    // Unexpected disconnect during hung write must immediately fail uploadA and bump sessionGeneration
    const genBeforeDrop = client.currentSessionGeneration;
    devA.simulateDrop();
    const errA = await uploadAErr;
    expect(errA).toBeInstanceOf(Error);
    expect((errA as Error).message).toContain("BLE connection closed");
    expect(client.currentSessionGeneration).toBeGreaterThan(genBeforeDrop);

    // Switch immediately to devB BEFORE old hung write resolves
    nextPick = devB;
    await client.connect();
    const uploadB = client.uploadDialImage(jpeg, { expectedDeviceId: "dev-b", chunkSize: 1000 });

    // Late resolution of devA's old hung write + stale devA notification MUST NOT interfere with devB!
    releaseHungWrite();
    devA.notify1.emitNotify(buildDialStatusNotify(2));

    await new Promise((r) => setTimeout(r, 40));
    devB.notify1.emitNotify(buildDialStatusNotify(1000));
    await new Promise((r) => setTimeout(r, 40));
    devB.notify1.emitNotify(buildDialStatusNotify(1001));
    await new Promise((r) => setTimeout(r, 40));
    devB.notify1.emitNotify(buildDialStatusNotify(2));

    const resB = await uploadB;
    expect(resB.deviceId).toBe("dev-b");
    expect(devB.countWatchThemeFrames()).toEqual({ starts: 1, chunks: 1, finishes: 1 });
  });

  it("P1-3b: BleWriteQueue reset detaches suspended drain loops without consuming new generation items", async () => {
    let activeChar: WebBluetoothCharacteristic | null = null;
    let releaseFirst: () => void = () => undefined;
    const writes1: Uint8Array[] = [];
    const writes2: Uint8Array[] = [];

    const makeChar = (sink: Uint8Array[], blockFirst: boolean): WebBluetoothCharacteristic => ({
      uuid: MYWATCH_WRITE_UUID,
      properties: { write: true, writeWithoutResponse: false, notify: false },
      value: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
      readValue: async () => new DataView(new ArrayBuffer(0)),
      startNotifications: async function () {
        return this;
      },
      stopNotifications: async function () {
        return this;
      },
      writeValueWithResponse: async (buf) => {
        const view = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
        sink.push(new Uint8Array(view));
        if (blockFirst && sink.length === 1) {
          await new Promise<void>((r) => {
            releaseFirst = r;
          });
        }
      },
      writeValue: async () => undefined,
    });

    const queue = new BleWriteQueue(() => activeChar, () => false, () => undefined);
    activeChar = makeChar(writes1, true);

    const oldWrite = queue.enqueue(new Uint8Array(45).fill(0x11), { delayAfterMs: 0 });
    const oldRejected = oldWrite.catch((e: unknown) => e);
    await Promise.resolve();

    queue.reset(new Error("Reset on disconnect"));
    expect(await oldRejected).toBeInstanceOf(Error);

    activeChar = makeChar(writes2, false);
    const newWrite = queue.enqueue(new Uint8Array([0x22, 0x33]), { delayAfterMs: 0 });
    releaseFirst();
    await newWrite;

    expect(writes1).toHaveLength(1); // Never continued segments 2 & 3 after reset
    expect(Array.from(writes2[0])).toEqual([0x22, 0x33]);
  });

  it("P1-4: blocks blank canvases, algorithm != 4 devices, and unverified dialInfo before Start", () => {
    const emptyText = createDefaultTextOverlay();
    expect(hasPublishableBadgeContent(false, emptyText)).toBe(false);
    expect(hasPublishableBadgeContent(false, { enabled: true, text: "   " } as typeof emptyText)).toBe(
      false
    );
    expect(hasPublishableBadgeContent(false, { ...emptyText, enabled: true, text: "OK" })).toBe(
      true
    );

    const jpeg = makeSampleBaselineJpeg();
    const profiles = upsertDeviceProfile([], { id: "dev-1", advertisedName: "BG02" });

    // Case 1: Empty content
    const okMeta: ConnectedDeviceMetadata = {
      deviceId: "dev-1",
      deviceName: "BG02",
      writeCapabilities: { write: true, writeWithoutResponse: true },
      notifyCount: 2,
      dialInfo: makeDialInfo(),
      freeStorageBytes: 40_000,
      freeStorageError: null,
      standardInfo: { batteryPercent: 80 },
    };
    const okView = resolveSendTargetView({
      selectedSendTargetId: "dev-1",
      savedDevices: profiles,
      clientConnected: true,
      clientActiveId: "dev-1",
      connectedMetadata: okMeta,
    });
    expect(
      evaluateUploadGate({
        hasSourceImage: false,
        textOverlay: emptyText,
        targetView: okView,
        latestOutput: makeOutputFromJpeg(jpeg, 1),
        draftGeneration: 1,
      })
    ).toEqual({ allowed: false, reason: "empty_content" });

    // Case 2: algorithm=3 (JieLi BMP firmware) rejected
    const bmpMeta: ConnectedDeviceMetadata = {
      ...okMeta,
      dialInfo: makeDialInfo({ algorithm: 3, algorithmName: "JieLi BMP (3)" }),
    };
    expect(assessDeviceUploadSupport(bmpMeta)).toEqual({
      supported: false,
      reason: "unsupported_algorithm",
      algorithm: 3,
    });
    const bmpView = resolveSendTargetView({
      selectedSendTargetId: "dev-1",
      savedDevices: profiles,
      clientConnected: true,
      clientActiveId: "dev-1",
      connectedMetadata: bmpMeta,
    });
    expect(
      evaluateUploadGate({
        hasSourceImage: true,
        textOverlay: emptyText,
        targetView: bmpView,
        latestOutput: makeOutputFromJpeg(jpeg, 1),
        draftGeneration: 1,
      })
    ).toEqual({ allowed: false, reason: "unsupported_algorithm" });

    // Case 3: Unverified dialInfo === null rejected (no silent 240x240 assumption on upload)
    const unverifiedMeta: ConnectedDeviceMetadata = {
      ...okMeta,
      dialInfo: null,
    };
    expect(assessDeviceUploadSupport(unverifiedMeta)).toEqual({
      supported: false,
      reason: "unverified_device",
    });
    const unverifiedView = resolveSendTargetView({
      selectedSendTargetId: "dev-1",
      savedDevices: profiles,
      clientConnected: true,
      clientActiveId: "dev-1",
      connectedMetadata: unverifiedMeta,
    });
    expect(
      evaluateUploadGate({
        hasSourceImage: true,
        textOverlay: emptyText,
        targetView: unverifiedView,
        latestOutput: makeOutputFromJpeg(jpeg, 1),
        draftGeneration: 1,
      })
    ).toEqual({ allowed: false, reason: "unverified_device" });
  });

  it("P2: verifies immutable FrozenUploadSession, scoped SW cache checks, and deleted tombstone exclusion", async () => {
    // 1. FrozenUploadSession isolation
    const jpegOriginal = makeSampleBaselineJpeg(240, 240, 0x55);
    const okMeta: ConnectedDeviceMetadata = {
      deviceId: "dev-1",
      deviceName: "BG02",
      writeCapabilities: { write: true, writeWithoutResponse: true },
      notifyCount: 2,
      dialInfo: makeDialInfo(),
      freeStorageBytes: 40_000,
      freeStorageError: null,
      standardInfo: { batteryPercent: 90 },
    };
    const view = resolveSendTargetView({
      selectedSendTargetId: "dev-1",
      savedDevices: upsertDeviceProfile([], { id: "dev-1", advertisedName: "BG02" }),
      clientConnected: true,
      clientActiveId: "dev-1",
      connectedMetadata: okMeta,
    });
    const gate = evaluateUploadGate({
      hasSourceImage: true,
      textOverlay: createDefaultTextOverlay(),
      targetView: view,
      latestOutput: makeOutputFromJpeg(jpegOriginal, 4),
      draftGeneration: 4,
    });
    expect(gate.allowed).toBe(true);
    if (gate.allowed) {
      jpegOriginal[25] = 0x99; // Mutating caller array must not alter frozen payload
      expect(gate.frozenSession.jpegBytes[25]).toBe(0x55);
    }

    // 2. Scoped Service Worker cache readiness check
    const scope = "https://katsu2013.github.io/bg02-studio/";
    const wrongBucket = "bg02-studio:/other-app/:abc123";
    const rightBucket = `${buildScopedCachePrefix(scope)}def456`;

    const onlySiblingCaches = {
      keys: async () => [wrongBucket],
      open: async () => ({ match: async () => ({ ok: true }) }),
    };
    expect(
      await verifyScopedServiceWorkerReady(
        { scope, active: { state: "activated" } },
        onlySiblingCaches,
        true
      )
    ).toBe(false);

    const matchingEmptyCache = {
      keys: async () => [rightBucket],
      open: async () => ({ match: async () => undefined }),
    };
    expect(
      await verifyScopedServiceWorkerReady(
        { scope, active: { state: "activated" } },
        matchingEmptyCache,
        true
      )
    ).toBe(false);

    const readyCache = {
      keys: async () => [wrongBucket, rightBucket],
      open: async (name: string) => ({
        match: async (req: string) =>
          name === rightBucket && req === `${scope}index.html` ? { ok: true } : undefined,
      }),
    };
    expect(
      await verifyScopedServiceWorkerReady(
        { scope, active: { state: "activated" } },
        readyCache,
        true
      )
    ).toBe(true);

    // 3. Deleted badge tombstone prevents getDevices() resurrection without forget()
    const deletedDev = new SimBg02Device("deleted-1", "BG02");
    restoreNav = stubNavigatorBluetooth({
      requestDevice: vi.fn(),
      getDevices: vi.fn(async () => [deletedDev]),
    });

    const deletedList = addDeletedDeviceId([], "deleted-1");
    const deletedSet = new Set(deletedList);
    const client = new Bg02Client();
    const liveIds = await client.refreshPermittedDevices(deletedSet);
    expect(liveIds).toEqual([]);
    expect(client.hasLiveDevice("deleted-1")).toBe(false);

    const prefs = { ...createDefaultReconnectPrefs(), lastActiveDeviceId: "deleted-1" };
    expect(pickStartupReconnectTarget([], new Set(["deleted-1"]), prefs, deletedSet)).toBeNull();
    expect(
      resolveUploadReconnectPlan({
        activeDeviceId: "deleted-1",
        clientActiveId: null,
        canReconnect: false,
        savedDevices: [],
        liveDeviceIds: ["deleted-1"],
        prefs,
        deletedDeviceIds: deletedSet,
      })
    ).toEqual({ reuseDevice: false, targetDeviceId: undefined });

    // Re-adding clears tombstone explicitly
    const clearedSet = new Set(clearDeletedDeviceId(deletedList, "deleted-1"));
    expect(pickStartupReconnectTarget([], new Set(["deleted-1"]), prefs, clearedSet)).toBe(
      "deleted-1"
    );
  });
});
