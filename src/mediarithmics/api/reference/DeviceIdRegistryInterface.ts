export type TimeStamp = number; //long

export interface DeviceIdRegistryResource {
  id: string;
  token: string;
  name: string;
  description: string;
  drop_before_reduction: boolean;
  type: DeviceIdRegistryType;
  image_uri?: string;
  organisation_id: string;
  creation_ts: TimeStamp;
  last_modified_ts?: TimeStamp;
  created_by: string;
  last_modified_by?: TimeStamp;
}

export enum DeviceIdRegistryType {
  MUM_ID = 'MUM_ID',
  MOBILE_ADVERTISING_ID = 'MOBILE_ADVERTISING_ID',
  MOBILE_VENDOR_ID = 'MOBILE_VENDOR_ID',
  INSTALLATION_ID = 'INSTALLATION_ID',
  CUSTOM_DEVICE_ID = 'CUSTOM_DEVICE_ID',
  NETWORK_DEVICE_ID = 'NETWORK_DEVICE_ID',
  TV_ADVERTISING_ID = 'TV_ADVERTISING_ID',
}
