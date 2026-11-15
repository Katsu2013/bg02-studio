import { describe, expect, it } from "vitest";
import type { WebBluetoothCharacteristic } from "../ble/webBluetooth.types";
import { BleWriteQueue } from "../ble/writeQueue";

function createMockCharacteristic(): {
  char: WebBluetoothCharacteristic;
  writes: Uint8Array[];
} {
  const writes: Uint8Array[] = [];
  const char: WebBluetoothCharacteristic = {
    uuid: "7e400002-b5a3-f393-e0a9-e50e24dcca9d",
    properties: {
      write: true,
      writeWithoutResponse: true,
      notify: false,
    },
    value: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    readValue: async () => new DataView(new ArrayBuffer(0)),
    startNotifications: async () => char,
    stopNotifications: async () => char,
    writeValueWithResponse: async (buf: BufferSource) => {
      const view =
        buf instanceof ArrayBuffer
          ? new Uint8Array(buf)
          : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      writes.push(new Uint8Array(view));
    },
    writeValue: async () => undefined,
  };
  return { char, writes };
}

describe("BleWriteQueue", () => {
  it("segments payloads into <=20-byte GATT packets in order", async () => {
    const { char, writes } = createMockCharacteristic();
    const queue = new BleWriteQueue(() => char, () => false, () => undefined);

    const payload = new Uint8Array(45);
    payload.forEach((_v, idx) => {
      payload[idx] = idx;
    });

    await queue.enqueue(payload, { delayAfterMs: 0 });
    expect(writes.map((w) => w.length)).toEqual([20, 20, 5]);
    expect(Array.from(writes[2])).toEqual([40, 41, 42, 43, 44]);
  });

  it("prioritizes <=20-byte ACK frames ahead of queued data frames", async () => {
    const { char, writes } = createMockCharacteristic();
    let releaseFirstWrite: () => void = () => undefined;
    const blockingFirst: WebBluetoothCharacteristic = {
      ...char,
      writeValueWithResponse: async (buf: BufferSource) => {
        const view =
          buf instanceof ArrayBuffer
            ? new Uint8Array(buf)
            : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        writes.push(new Uint8Array(view));
        if (writes.length === 1) {
          await new Promise<void>((res) => {
            releaseFirstWrite = res;
          });
        }
      },
    };

    const queue = new BleWriteQueue(() => blockingFirst, () => false, () => undefined);
    const p1 = queue.enqueue(new Uint8Array([0x01, 0x02]), { delayAfterMs: 0 });
    const p2 = queue.enqueue(new Uint8Array(25).fill(0xaa), { delayAfterMs: 0 });
    const ack = queue.enqueue(new Uint8Array([0xdc, 0x00, 0x05]), {
      priority: true,
      delayAfterMs: 0,
    });

    // Wait one microtask so p1 reaches blockingFirst.writeValueWithResponse
    await Promise.resolve();
    releaseFirstWrite();
    await Promise.all([p1, p2, ack]);

    // Packet order must be: [0x01,0x02] (already started), then priority [0xDC,...], then [0xAA...] chunks
    expect(Array.from(writes[0])).toEqual([0x01, 0x02]);
    expect(Array.from(writes[1])).toEqual([0xdc, 0x00, 0x05]);
    expect(writes[2].length).toBe(20);
    expect(writes[3].length).toBe(5);
  });

  it("rejects queued promises cleanly when reset after disconnect", async () => {
    const queue = new BleWriteQueue(() => null, () => false, () => undefined);
    await expect(queue.enqueue(new Uint8Array([1, 2]))).rejects.toThrow("BG02 is not connected");
  });
});
