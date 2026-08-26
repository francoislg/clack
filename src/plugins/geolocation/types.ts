export type GeoResult =
  | {
      ip: string;
      found: true;
      countryCode: string;
      country?: string;
      continent?: string;
      continentCode?: string;
      isEU: boolean;
    }
  | { ip: string; found: false; reason: string };
