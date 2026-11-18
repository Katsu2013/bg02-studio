/**
 * @module ble/webBluetooth.types
 * Minimal, strictly typed Web Bluetooth API structural declarations so the project
 * builds cleanly with `strict: true` and zero external `@types/*` runtime/type packages.
 */

/** Bitfield flags describing capabilities supported by a GATT characteristic. */
export interface WebBluetoothCharacteristicProperties {
  /** Whether characteristic reads (`readValue`) are permitted. */
  readonly read?: boolean;
  /** Whether reliable Write With Response is supported. */
  readonly write: boolean;
  /** Whether faster Write Without Response is supported. */
  readonly writeWithoutResponse: boolean;
  /** Whether value notifications are supported. */
  readonly notify: boolean;
}

/** Event fired when a subscribed GATT characteristic delivers a notification payload. */
export interface WebBluetoothValueChangedEvent extends Event {
  /** Target characteristic holding the latest `value` DataView. */
  readonly target: EventTarget & {
    /** Notification payload bytes, or `null` if unavailable. */
    readonly value: DataView | null;
  };
}

/** GATT characteristic interface supporting reads, writes, and notification subscriptions. */
export interface WebBluetoothCharacteristic extends EventTarget {
  /** Canonical lowercase UUID string of the characteristic. */
  readonly uuid: string;
  /** Capability flags advertised by the peripheral. */
  readonly properties: WebBluetoothCharacteristicProperties;
  /** Latest cached value received from read or notification events. */
  readonly value: DataView | null;

  /** Reads the characteristic value from the GATT server. */
  readValue(): Promise<DataView>;
  /** Writes a value expecting an ATT write response. */
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  /** Writes a value without expecting an ATT write response. */
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  /** Legacy write method kept as fallback for older Chromium Web Bluetooth implementations. */
  writeValue(value: BufferSource): Promise<void>;
  /** Starts characteristic notifications. */
  startNotifications(): Promise<WebBluetoothCharacteristic>;
  /** Stops characteristic notifications. */
  stopNotifications(): Promise<WebBluetoothCharacteristic>;
}

/** Primary GATT service exposing characteristics. */
export interface WebBluetoothService {
  /** Canonical lowercase UUID string of the service. */
  readonly uuid: string;
  /** Resolves a characteristic by full UUID or 16-bit assigned number/string. */
  getCharacteristic(characteristic: string | number): Promise<WebBluetoothCharacteristic>;
}

/** Active GATT server connection attached to a Bluetooth device. */
export interface WebBluetoothGattServer {
  /** Back-reference to the owning device. */
  readonly device: WebBluetoothDevice;
  /** Whether the GATT link is currently connected. */
  readonly connected: boolean;
  /** Opens a GATT connection to the remote device. */
  connect(): Promise<WebBluetoothGattServer>;
  /** Closes the active GATT connection. */
  disconnect(): void;
  /** Discovers a primary GATT service by UUID or 16-bit assigned number. */
  getPrimaryService(service: string | number): Promise<WebBluetoothService>;
}

/** Selected remote Bluetooth Low Energy peripheral device. */
export interface WebBluetoothDevice extends EventTarget {
  /** Opaque browser-scoped identifier for the device. */
  readonly id: string;
  /** Advertised GAP device name, if present. */
  readonly name?: string;
  /** Associated GATT server interface, if supported by the platform. */
  readonly gatt?: WebBluetoothGattServer;
  /**
   * Revokes site-level Web Bluetooth permission for this device cleanly when supported (Chromium).
   * Does not remove OS-level bonded entries in system Bluetooth settings.
   */
  forget?(): Promise<void>;
}

/** Scan filter entry passed to `navigator.bluetooth.requestDevice()`. */
export interface WebBluetoothScanFilter {
  /** Optional list of advertised GATT service UUIDs or 16-bit numbers. */
  readonly services?: ReadonlyArray<string | number>;
  /** Optional advertised device name prefix. */
  readonly namePrefix?: string;
}

/** Options object passed to `navigator.bluetooth.requestDevice()`. */
export interface WebBluetoothRequestDeviceOptions {
  /** When `true`, shows all nearby BLE peripherals regardless of advertised UUIDs. */
  readonly acceptAllDevices?: boolean;
  /** Optional scan filters used when `acceptAllDevices` is not enabled. */
  readonly filters?: ReadonlyArray<WebBluetoothScanFilter>;
  /** Non-advertised GATT services that the web app intends to access after connecting. */
  readonly optionalServices?: ReadonlyArray<string | number>;
}

/** Browser `navigator.bluetooth` entry point interface. */
export interface WebBluetoothApi {
  /** Opens the browser device chooser dialog and returns the selected device. */
  requestDevice(options: WebBluetoothRequestDeviceOptions): Promise<WebBluetoothDevice>;
  /**
   * Returns previously permitted Bluetooth devices without prompting the user, when supported.
   */
  getDevices?(): Promise<WebBluetoothDevice[]>;
}

declare global {
  /** Augments the standard DOM `Navigator` interface with optional Web Bluetooth support. */
  interface Navigator {
    /** Web Bluetooth entry point available in secure contexts on Chromium-based browsers. */
    readonly bluetooth?: WebBluetoothApi;
  }
}
