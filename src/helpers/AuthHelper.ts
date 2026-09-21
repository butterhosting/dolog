import { Credentials } from "@/models/Credentials";

export namespace AuthHelper {
  export function extractBasicAuth(header: string | null | undefined): Credentials | undefined {
    try {
      if (header) {
        const prefix = "Basic ";
        if (header.toLowerCase().startsWith(prefix.toLowerCase())) {
          const encodedCredentials = header.slice(prefix.length);
          if (encodedCredentials.length > 0) {
            const credentials = Buffer.from(encodedCredentials, "base64").toString("utf-8");
            const separator = credentials.indexOf(":");
            if (separator >= 0) {
              return {
                username: credentials.slice(0, separator),
                password: credentials.slice(separator + 1),
              };
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }
}
