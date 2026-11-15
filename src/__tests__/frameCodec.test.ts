import { describe, expect, it } from "vitest";
import {
  buildDialChunkFrame,
  buildDialFinishFrame,
  buildDialStartFrame,
  buildGetDialInfoFrame,
  buildGetFreeStorageFrame,
  buildPairFrame,
  buildReadDialStatusFrame,
  byteSum32,
  consumeNotifyChunk,
  encodeAck,
  encodeCmdNoPayload,
  encodeCmdPayload,
  parseClockDialInfo,
  parseFreeStorageBytes,
  wrapDialPayload,
} from "../ble/frameCodec";
import {
  DEFAULT_WATCH_ID,
  DIAL_CFG_MASK_BG_ONLY,
  DIAL_FILE_TYPE_JPEG,
} from "../constants/ble";

describe("frameCodec", () => {
  it("builds exact Lqm2.r pairing frame matching APK capture", () => {
    const pair = buildPairFrame();
    expect(Array.from(pair)).toEqual([0xcd, 0x00, 0x06, 0x12, 0x01, 0x0a, 0x00, 0x01, 0x02]);
  });

  it("builds GET_DIAL_INFO, GET_FREE_STORAGE, and READ_DIAL_STATUS 8-byte query frames", () => {
    expect(Array.from(buildGetDialInfoFrame())).toEqual([
      0xcd, 0x00, 0x05, 0x20, 0x01, 0x02, 0x00, 0x00,
    ]);
    expect(Array.from(buildGetFreeStorageFrame())).toEqual([
      0xcd, 0x00, 0x05, 0x20, 0x01, 0x04, 0x00, 0x00,
    ]);
    expect(Array.from(buildReadDialStatusFrame())).toEqual([
      0xcd, 0x00, 0x05, 0x20, 0x01, 0x01, 0x00, 0x00,
    ]);
  });

  it("encodes 0xDC ACK frames with echoed length", () => {
    const ack = encodeAck(0x20, 0x02, 40);
    expect(Array.from(ack)).toEqual([0xdc, 0x00, 0x05, 0x20, 0x02, 0x00, 0x28, 0x01]);
  });

  it("computes unsigned 32-bit byte sum", () => {
    const data = new Uint8Array([0xff, 0xff, 0x01]);
    expect(byteSum32(data)).toBe(511);

    const filled = new Uint8Array(200).fill(0xff);
    expect(byteSum32(filled)).toBe(200 * 255);
  });

  it("wraps image payload and builds WatchTheme3 Start/Chunk/Finish frames", () => {
    const dummyImg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const wrapped = wrapDialPayload(dummyImg);
    expect(Array.from(wrapped)).toEqual([0x00, 0x00, 0x00, 0x04, 0xff, 0xd8, 0xff, 0xd9]);

    const start = buildDialStartFrame({
      watchId: DEFAULT_WATCH_ID,
      fileType: DIAL_FILE_TYPE_JPEG,
      wrappedLength: wrapped.length,
      cfgMask: DIAL_CFG_MASK_BG_ONLY,
    });
    expect(start.length).toBe(8 + 17);
    expect(start[3]).toBe(0x1f);
    expect(start[5]).toBe(0x02);
    // payload offset 8: watchId 5538 = 0x000015a2, fileType=2, cfgMask=0x08
    expect(Array.from(start.subarray(8, 14))).toEqual([0x00, 0x00, 0x15, 0xa2, 0x02, 0x08]);
    // wrapped length at bytes 9..12 of payload => frame[17..20]
    expect(Array.from(start.subarray(17, 21))).toEqual([0x00, 0x00, 0x00, 0x08]);

    const chunk = buildDialChunkFrame(1, wrapped);
    // 8 byte frame header + 2 byte seq + 8 byte data + 4 byte sum = 22
    expect(chunk.length).toBe(22);
    expect(chunk[8]).toBe(0x00);
    expect(chunk[9]).toBe(0x01);
    const expectedInnerSum = byteSum32(new Uint8Array([0x00, 0x01, ...wrapped]));
    const chunkDv = new DataView(chunk.buffer);
    expect(chunkDv.getUint32(18, false)).toBe(expectedInnerSum);

    const finish = buildDialFinishFrame(byteSum32(wrapped));
    expect(finish.length).toBe(12);
    expect(finish[3]).toBe(0x1f);
    expect(finish[5]).toBe(0x03);
  });

  it("reassembles multi-packet 0xCD notifications and separates standalone 0xDC ACKs", () => {
    const ackOnly = consumeNotifyChunk(
      new Uint8Array(0),
      new Uint8Array([0xdc, 0x00, 0x05, 0x12, 0x0a, 0x00, 0x09, 0x01])
    );
    expect(ackOnly.ackPackets).toHaveLength(1);
    expect(ackOnly.frames).toHaveLength(0);
    expect(ackOnly.nextBuffer).toHaveLength(0);

    // Embedded 0xDC inside payload must NOT trigger ACK shortcut when assembled across two chunks
    const fullFrame = encodeCmdPayload(0x20, 0x01, new Uint8Array([0xdc, 0x00, 0x03, 0xe8]));
    const split1 = fullFrame.subarray(0, 6);
    const split2 = fullFrame.subarray(6);

    const step1 = consumeNotifyChunk(new Uint8Array(0), split1);
    expect(step1.frames).toHaveLength(0);
    expect(step1.nextBuffer.length).toBe(6);

    const step2 = consumeNotifyChunk(step1.nextBuffer, split2);
    expect(step2.frames).toHaveLength(1);
    expect(step2.frames[0].cmdId).toBe(0x20);
    expect(step2.frames[0].cmdKey).toBe(0x01);
    expect(Array.from(step2.frames[0].payload)).toEqual([0xdc, 0x00, 0x03, 0xe8]);
  });

  it("skips noise bytes before syncing to valid 0xCD frames", () => {
    const noise = new Uint8Array([0x00, 0xcd, 0x00, 0x01]); // invalid bodyLen=1 at index 1
    const valid = encodeCmdNoPayload(0x20, 0x02);
    const combined = new Uint8Array([...noise, ...valid]);
    const res = consumeNotifyChunk(new Uint8Array(0), combined);
    expect(res.frames).toHaveLength(1);
    expect(res.frames[0].cmdId).toBe(0x20);
    expect(res.frames[0].cmdKey).toBe(0x02);
  });

  it("parses real BG02 ClockDialInfoBody (240x240 round JPEG)", () => {
    // Construct binary ClockDialInfo matching observed BG02 telemetry:
    // screenType=1 (round), grade=0, 240x240, mchModel="K66", mainModel="LJ733",
    // config=7, algorithm=4, version bytes [0,0,0], customer="JQ001",
    // pictureNums=0, watchThemeVersion=9, shortPkgLength=5000
    const mch = new TextEncoder().encode("K66");
    const main = new TextEncoder().encode("LJ733");
    const cust = new TextEncoder().encode("JQ001");
    const payload = new Uint8Array([
      1, // screenType
      0, // grade
      0x00, 240, // width
      0x00, 240, // height
      mch.length,
      ...mch,
      main.length,
      ...main,
      7, // config
      4, // algorithm JPEG
      0x01, 0x01, 0x00, // b0 - b1 === b2 => versionCode=0
      cust.length,
      ...cust,
      0, // pictureNums (pos2 + 1)
      0x00, 0x09, // watchThemeVersion = 9 (BE at pos2 + 2)
      0x13, 0x88, // watchThemeShortPkgLength = 5000 (BE at pos2 + 4)
    ]);

    const parsed = parseClockDialInfo(payload);
    expect(parsed.shape).toBe("round");
    expect(parsed.width).toBe(240);
    expect(parsed.height).toBe(240);
    expect(parsed.mchModel).toBe("K66");
    expect(parsed.mainModel).toBe("LJ733");
    expect(parsed.algorithmName).toBe("JPEG (4)");
    expect(parsed.customer).toBe("JQ001");
    expect(parsed.pictureNums).toBe(0);
    expect(parsed.watchThemeVersion).toBe(9);
    expect(parsed.watchThemeShortPkgLength).toBe(5000);
  });

  it("parses uint64 big-endian free storage bytes", () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, 356352n, false);
    expect(parseFreeStorageBytes(buf)).toBe(356352);
    expect(parseFreeStorageBytes(new Uint8Array(4))).toBeNull();
  });
});
