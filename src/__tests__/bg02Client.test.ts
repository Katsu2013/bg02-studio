import { afterEach, describe, expect, it, vi } from "vitest";
import { Bg02Client } from "../ble/bg02Client";
import { encodeCmdPayload } from "../ble/frameCodec";
import { Bg02ProtocolError, isRetryableUploadError } from "../ble/types";
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
  DIAL_FINISH_STEP_TIMEOUT_MS,
  MYWATCH_NOTIFY1_UUID,
  MYWATCH_NOTIFY2_UUID,
  MYWATCH_SERVICE_UUID,
  MYWATCH_WRITE_UUID,
  STANDARD_CHARACTERISTICS,
  STANDARD_SERVICES,
} from "../constants/ble";

class FakeCharacteristic extends EventTarget implements WebBluetoothCharacteristic {
  public readonly uuid: string;
  public readonly properties = {
    write: true,
    writeWithoutResponse: true,
    notify: true,
  };
  public value: DataView | null = null;
  public readonly writes: Uint8Array[] = [];

  public constructor(uuid: string) {
    super();
    this.uuid = uuid;
  }

  public async readValue(): Promise<DataView> {
    return new DataView(new ArrayBuffer(0));
  }

  public async writeValueWithResponse(value: BufferSource): Promise<void> {
    const view = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer);
    this.writes.push(view);
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

class FakeDevice extends EventTarget implements WebBluetoothDevice {
  public readonly id: string;
  public readonly name?: string;
  public readonly gatt: WebBluetoothGattServer;
  public readonly writeChar: FakeCharacteristic;
  public readonly notify1: FakeCharacteristic;
  private isConnected = false;

  public constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;

    const writeChar = new FakeCharacteristic(MYWATCH_WRITE_UUID);
    const notify1 = new FakeCharacteristic(MYWATCH_NOTIFY1_UUID);
    const notify2 = new FakeCharacteristic(MYWATCH_NOTIFY2_UUID);
    this.writeChar = writeChar;
    this.notify1 = notify1;

    const service: WebBluetoothService = {
      uuid: MYWATCH_SERVICE_UUID,
      getCharacteristic: async (uuid: string | number) => {
        if (uuid === MYWATCH_WRITE_UUID) return writeChar;
        if (uuid === MYWATCH_NOTIFY1_UUID) return notify1;
        if (uuid === MYWATCH_NOTIFY2_UUID) return notify2;
        throw new Error(`Unexpected char: ${uuid}`);
      },
    };

    const self = this;
    this.gatt = {
      device: this,
      get connected() {
        return self.isConnected;
      },
      connect: async () => {
        self.isConnected = true;
        return this.gatt;
      },
      disconnect: () => {
        if (self.isConnected) {
          self.isConnected = false;
          self.dispatchEvent(new Event("gattserverdisconnected"));
        }
      },
      getPrimaryService: async () => service,
    };
  }

  public simulateUnexpectedDrop(): void {
    this.isConnected = false;
    this.dispatchEvent(new Event("gattserverdisconnected"));
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

describe("Bg02Client multi-device & disconnect classification", () => {
  let restoreNav: (() => void) | null = null;

  afterEach(() => {
    vi.useRealTimers();
    restoreNav?.();
    restoreNav = null;
  });

  it("caches multiple devices, switches without reopening chooser, and distinguishes manual vs unexpected drops", async () => {
    const devA = new FakeDevice("dev-a", "BG02");
    const devB = new FakeDevice("dev-b", "BG02");
    const requestDevice = vi
      .fn<WebBluetoothApi["requestDevice"]>()
      .mockResolvedValueOnce(devA)
      .mockResolvedValueOnce(devB);

    restoreNav = stubNavigatorBluetooth({ requestDevice });

    const client = new Bg02Client();
    const events: Array<{ reason: string; deviceId: string }> = [];
    client.setOnDisconnect((reason, deviceId) => {
      events.push({ reason, deviceId });
    });

    // Pair device A via picker
    const metaA = await client.connect();
    expect(metaA.deviceId).toBe("dev-a");
    expect(client.activeId).toBe("dev-a");
    expect(client.hasLiveDevice("dev-a")).toBe(true);

    // Pair device B via picker; switching cleanly ignores stale disconnect events from A
    const metaB = await client.connect();
    expect(metaB.deviceId).toBe("dev-b");
    expect(client.activeId).toBe("dev-b");
    expect(client.getLiveDeviceIds()).toEqual(["dev-a", "dev-b"]);
    expect(requestDevice).toHaveBeenCalledTimes(2);

    // Switch back to A via reuseDevice without calling requestDevice()
    const switchedA = await client.connect({ reuseDevice: true, deviceId: "dev-a" });
    expect(switchedA.deviceId).toBe("dev-a");
    expect(requestDevice).toHaveBeenCalledTimes(2);

    // Late unexpected disconnect on inactive B must NOT trigger active disconnect callback
    devB.simulateUnexpectedDrop();
    expect(events).toHaveLength(0);
    expect(client.isConnected).toBe(true);

    // Unsolicited drop on active A fires unexpected disconnect
    devA.simulateUnexpectedDrop();
    expect(events).toEqual([{ reason: "unexpected", deviceId: "dev-a" }]);
    expect(client.isConnected).toBe(false);

    // Manual disconnect after reconnecting fires manual disconnect
    await client.connect({ reuseDevice: true, deviceId: "dev-a" });
    await client.disconnect();
    expect(events).toEqual([
      { reason: "unexpected", deviceId: "dev-a" },
      { reason: "manual", deviceId: "dev-a" },
    ]);
  });

  it("populates permitted handles via getDevices() and removes handles on forgetCachedDevice()", async () => {
    const devPermitted = new FakeDevice("perm-1", "BG02");
    const api: WebBluetoothApi = {
      requestDevice: vi.fn<WebBluetoothApi["requestDevice"]>(),
      getDevices: vi.fn(async () => [devPermitted]),
    };
    restoreNav = stubNavigatorBluetooth(api);

    const client = new Bg02Client();
    const liveIds = await client.refreshPermittedDevices();
    expect(liveIds).toEqual(["perm-1"]);
    expect(client.hasLiveDevice("perm-1")).toBe(true);

    const meta = await client.connect({ reuseDevice: true, deviceId: "perm-1" });
    expect(meta.deviceId).toBe("perm-1");
    expect(api.requestDevice).not.toHaveBeenCalled();

    await client.disconnect();
    client.forgetCachedDevice("perm-1");
    expect(client.hasLiveDevice("perm-1")).toBe(false);
    expect(client.activeId).toBeNull();
  });
});

function buildDialStatusNotify(code: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, code >>> 0, false);
  return encodeCmdPayload(BLE_MODULE.DIAL_CONTROL, BLE_SUB_CMD.DIAL_RESPONSE, payload);
}

describe("Bg02Client WatchTheme3 finish recovery & error classification", () => {
  let restoreNav: (() => void) | null = null;

  afterEach(() => {
    vi.useRealTimers();
    restoreNav?.();
    restoreNav = null;
  });

  it("polls status and resends DIAL_FINISH when stalled at 95%, succeeding on retry", async () => {
    vi.useFakeTimers();
    const dev = new FakeDevice("dev-finish", "BG02");
    restoreNav = stubNavigatorBluetooth({
      requestDevice: vi.fn(async () => dev),
    });

    const client = new Bg02Client();
    const connectPromise = client.connect();
    await vi.runAllTimersAsync();
    await connectPromise;

    const dummyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    const progressRatios: number[] = [];
    const uploadPromise = client.uploadDialImage(dummyJpeg, {
      onProgress: (p) => progressRatios.push(p.ratio),
    });

    // Drain DIAL_START write
    await vi.advanceTimersByTimeAsync(100);
    // Acknowledge Start (1000) -> triggers Chunk #1 write -> reaches 95%
    dev.notify1.emitNotify(buildDialStatusNotify(1000));
    await vi.advanceTimersByTimeAsync(100);
    expect(progressRatios).toContain(0.95);

    // Acknowledge Chunk #1 (1001) -> triggers initial DIAL_FINISH (0x1F/0x03)
    dev.notify1.emitNotify(buildDialStatusNotify(1001));
    await vi.advanceTimersByTimeAsync(100);

    const writesBeforeRetry = dev.writeChar.writes.length;

    // Stall for DIAL_FINISH_STEP_TIMEOUT_MS -> client must poll 0x20/0x01 and resend DIAL_FINISH
    await vi.advanceTimersByTimeAsync(DIAL_FINISH_STEP_TIMEOUT_MS + 50);
    const addedWrites = dev.writeChar.writes.slice(writesBeforeRetry);
    // 1st added frame: READ_DIAL_STATUS (0x20/0x01, 8B), 2nd added frame: DIAL_FINISH (0x1F/0x03, 12B)
    expect(addedWrites.some((w) => w.length === 8 && w[3] === 0x20 && w[5] === 0x01)).toBe(true);
    expect(addedWrites.some((w) => w.length === 12 && w[3] === 0x1f && w[5] === 0x03)).toBe(true);

    // Device responds FINISH_OK (2) -> resolves cleanly at 100%
    dev.notify1.emitNotify(buildDialStatusNotify(2));
    await vi.advanceTimersByTimeAsync(50);

    const result = await uploadPromise;
    expect(result.imageBytes).toBe(dummyJpeg.length);
    expect(progressRatios[progressRatios.length - 1]).toBe(1);
  });

  it("marks exhausted 95% Finish timeouts retryable while keeping code 3/4/5 non-retryable", async () => {
    vi.useFakeTimers();
    const dev = new FakeDevice("dev-codes", "BG02");
    restoreNav = stubNavigatorBluetooth({
      requestDevice: vi.fn(async () => dev),
    });

    const client = new Bg02Client();
    const connectPromise = client.connect();
    await vi.runAllTimersAsync();
    await connectPromise;

    const dummyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    // Case 1: Exhausted DIAL_FINISH retries -> retryable timeout (statusCode === undefined)
    const timeoutUpload = client.uploadDialImage(dummyJpeg);
    const timeoutRejection = timeoutUpload.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    dev.notify1.emitNotify(buildDialStatusNotify(1000));
    await vi.advanceTimersByTimeAsync(100);
    dev.notify1.emitNotify(buildDialStatusNotify(1001));
    await vi.advanceTimersByTimeAsync(DIAL_FINISH_STEP_TIMEOUT_MS * 4 + 500);

    const timeoutErr = await timeoutRejection;
    expect(timeoutErr).toBeInstanceOf(Bg02ProtocolError);
    expect((timeoutErr as Bg02ProtocolError).statusCode).toBeUndefined();
    expect(isRetryableUploadError(timeoutErr)).toBe(true);

    // Case 2: Device rejects because battery < 20% (code 3) or charging (code 4)
    for (const [code, expectedKey] of [
      [3, "lowBattery"],
      [4, "deviceCharging"],
      [5, "storageFull"],
    ] as const) {
      const upload = client.uploadDialImage(dummyJpeg);
      const errPromise = upload.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(100);
      dev.notify1.emitNotify(buildDialStatusNotify(code));
      const err = await errPromise;
      expect(err).toBeInstanceOf(Bg02ProtocolError);
      expect((err as Bg02ProtocolError).statusCode).toBe(code);
      expect((err as Bg02ProtocolError).errorKey).toBe(expectedKey);
      expect(isRetryableUploadError(err)).toBe(false);
    }
  });

  it("invokes device.forget() when supported during forgetCachedDevice and cleans cache regardless", async () => {
    const devWithForget = new FakeDevice("dev-forget-yes", "BG02");
    const forgetSpy = vi.fn(async () => undefined);
    (devWithForget as WebBluetoothDevice & { forget?: () => Promise<void> }).forget = forgetSpy;

    const devWithoutForget = new FakeDevice("dev-forget-no", "BG02");
    let nextSelected: FakeDevice = devWithForget;

    restoreNav = stubNavigatorBluetooth({
      requestDevice: vi.fn(async () => nextSelected),
    });

    const client = new Bg02Client();
    await client.connect();
    expect(client.hasLiveDevice("dev-forget-yes")).toBe(true);

    const revoked = await client.forgetCachedDevice("dev-forget-yes");
    expect(revoked).toBe(true);
    expect(forgetSpy).toHaveBeenCalledTimes(1);
    expect(client.hasLiveDevice("dev-forget-yes")).toBe(false);
    expect(client.activeId).toBeNull();

    nextSelected = devWithoutForget;
    await client.connect();
    const localOnly = await client.forgetCachedDevice("dev-forget-no");
    expect(localOnly).toBe(false);
    expect(client.hasLiveDevice("dev-forget-no")).toBe(false);
  });

  it("drains pending ACK writes before Battery readValue, retries transient NetworkError, and forwards 0x2A19 notifications", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let releaseAckWrite: () => void = () => undefined;
    let holdNextAckWrite = false;
    let batteryReads = 0;

    const writeChar = new FakeCharacteristic(MYWATCH_WRITE_UUID);
    writeChar.writeValueWithResponse = async (value: BufferSource) => {
      const view =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      writeChar.writes.push(view);
      if (holdNextAckWrite && view[0] === 0xdc) {
        holdNextAckWrite = false;
        events.push("ack:start");
        await new Promise<void>((res) => {
          releaseAckWrite = () => {
            events.push("ack:done");
            res();
          };
        });
      }
    };

    const notify1 = new FakeCharacteristic(MYWATCH_NOTIFY1_UUID);
    const notify2 = new FakeCharacteristic(MYWATCH_NOTIFY2_UUID);
    const batteryChar = new FakeCharacteristic(STANDARD_CHARACTERISTICS.BATTERY_LEVEL);
    batteryChar.readValue = async () => {
      batteryReads += 1;
      events.push(`battery:read#${batteryReads}`);
      if (batteryReads === 1) {
        throw new DOMException("Simulated Android GATT busy", "NetworkError");
      }
      return new DataView(new Uint8Array([77]).buffer);
    };

    const myWatchSvc: WebBluetoothService = {
      uuid: MYWATCH_SERVICE_UUID,
      getCharacteristic: async (uuid: string | number) => {
        if (uuid === MYWATCH_WRITE_UUID) return writeChar;
        if (uuid === MYWATCH_NOTIFY1_UUID) return notify1;
        if (uuid === MYWATCH_NOTIFY2_UUID) return notify2;
        throw new Error(`Unexpected char: ${uuid}`);
      },
    };
    const batterySvc: WebBluetoothService = {
      uuid: "0000180f-0000-1000-8000-00805f9b34fb",
      getCharacteristic: async (uuid: string | number) => {
        if (uuid === STANDARD_CHARACTERISTICS.BATTERY_LEVEL) return batteryChar;
        throw new Error(`Unexpected char: ${uuid}`);
      },
    };

    let connected = false;
    const dev: WebBluetoothDevice = Object.assign(new EventTarget(), {
      id: "dev-android-batt",
      name: "BG02",
      gatt: {
        get connected() {
          return connected;
        },
        connect: async () => {
          connected = true;
          return dev.gatt!;
        },
        disconnect: () => {
          connected = false;
        },
        getPrimaryService: async (svc: string | number) => {
          if (svc === STANDARD_SERVICES.BATTERY) return batterySvc;
          if (svc === MYWATCH_SERVICE_UUID) return myWatchSvc;
          throw new Error(`Optional service absent: ${String(svc)}`);
        },
      } as WebBluetoothGattServer,
    });

    restoreNav = stubNavigatorBluetooth({
      requestDevice: vi.fn(async () => dev),
    });

    const client = new Bg02Client();
    const notifiedLevels: number[] = [];
    client.setOnBatteryChange((pct) => notifiedLevels.push(pct));

    const connectP = client.connect();
    await vi.runAllTimersAsync();
    await connectP;

    holdNextAckWrite = true;
    const freeP = client.getFreeStorage();
    await vi.advanceTimersByTimeAsync(15);

    const payload = new Uint8Array([0, 0, 0, 0, 0, 5, 112, 0]);
    notify1.emitNotify(encodeCmdPayload(BLE_MODULE.DIAL_CONTROL, BLE_SUB_CMD.GET_FREE_STORAGE, payload));
    expect(await freeP).toBe(356352);

    const stdP = client.readStandardInfo();
    await Promise.resolve();
    expect(events).toEqual(["ack:start"]);

    releaseAckWrite();
    await vi.runAllTimersAsync();
    const std = await stdP;

    expect(std.batteryPercent).toBe(77);
    expect(events).toEqual(["ack:start", "ack:done", "battery:read#1", "battery:read#2"]);

    batteryChar.emitNotify(new Uint8Array([68]));
    expect(notifiedLevels).toEqual([68]);
  });
});
