import { Logger } from "@/Logger";
import { Temporal } from "@js-temporal/polyfill";
import crypto from "crypto";

export type SupportToken = {
  app: string;
  amount: number;
  currency: string;
  timestamp: Temporal.Instant;
};

export namespace SupportToken {
  const log = new Logger(__filename, "lazy");

  export function verify({ hexToken, publicKey }: { hexToken?: string; publicKey: string }): SupportToken | undefined {
    try {
      if (!hexToken) {
        return undefined;
      }

      const token = Buffer.from(hexToken, "hex").toString("utf-8");
      const signatureMarker = ";s=";
      const signatureMarkerIndex = token.lastIndexOf(signatureMarker);
      if (signatureMarkerIndex === -1) {
        log.warn("Support token malformed");
        return undefined;
      }

      const payload = token.substring(0, signatureMarkerIndex);
      const signature = Buffer.from(token.substring(signatureMarkerIndex + signatureMarker.length), "base64");
      if (!crypto.verify(null, Buffer.from(payload), crypto.createPublicKey(publicKey), signature)) {
        log.warn("Support token invalid");
        return undefined;
      }

      const fields = new Map(
        payload.split(";").map((part) => {
          const eq = part.indexOf("=");
          return [part.substring(0, eq), part.substring(eq + 1)] as [string, string];
        }),
      );
      return {
        app: fields.get("app")!,
        amount: Number(fields.get("amt")!),
        currency: fields.get("cur")!,
        timestamp: Temporal.Instant.fromEpochMilliseconds(Number(fields.get("t")!) * 1000),
      };
    } catch (e) {
      log.warn("Support token validation error", e);
      return undefined;
    }
  }
}
