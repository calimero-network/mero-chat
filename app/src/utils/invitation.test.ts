import { describe, expect, it } from "vitest";
import {
  APP_SLUG,
  decodeInvitationPayload,
  generateInvitationDeepLink,
  generateInvitationUrl,
  parseGroupInvitationPayload,
  parseInvitationInput,
  serializeGroupInvitationPayload,
} from "./invitation";

const signedInvitation = {
  invitation: {
    inviter_identity: "admin",
    group_id: "group-1",
    expiration_height: 42,
    secret_salt: [1, 2, 3],
    protocol: "near",
    network: "testnet",
    contract_id: "contract.testnet",
  },
  inviter_signature: "signature",
};

describe("invitation utilities", () => {
  it("serializes and parses wrapped group invitations with aliases", () => {
    const payload = serializeGroupInvitationPayload({
      invitation: signedInvitation,
      groupAlias: "Product Team",
    });

    expect(parseGroupInvitationPayload(payload)).toEqual({
      invitation: signedInvitation,
      groupAlias: "Product Team",
    });
  });

  it("parses legacy raw invitation payloads without a group alias", () => {
    expect(
      parseGroupInvitationPayload(JSON.stringify(signedInvitation)),
    ).toEqual({
      invitation: signedInvitation,
    });
  });
});

describe("shareable invitation links", () => {
  const payload = JSON.stringify(signedInvitation);

  it("builds a canonical links.calimero.network URL keyed by the package slug", () => {
    const parsed = new URL(generateInvitationUrl(payload));

    expect(parsed.protocol).toBe("https:");
    expect(parsed.host).toBe("links.calimero.network");
    // The slug IS the bundle's package id — the desktop resolves the app by it,
    // and the landing page asks the registry for that package's frontend.
    expect(parsed.pathname).toBe(`/${APP_SLUG}/join`);

    const encoded = parsed.searchParams.get("invitation");
    expect(encoded).toBeTruthy();
    expect(decodeInvitationPayload(encoded as string)).toBe(payload);
  });

  it("builds a calimero:// device link with the same slug", () => {
    const link = generateInvitationDeepLink(payload);
    expect(link.startsWith(`calimero://${APP_SLUG}/join?invitation=`)).toBe(true);
    expect(decodeInvitationPayload(link.split("invitation=")[1])).toBe(payload);
  });

  it("reads the invitation back out of either generated link", () => {
    expect(parseInvitationInput(generateInvitationUrl(payload))).toBe(payload);
    expect(parseInvitationInput(generateInvitationDeepLink(payload))).toBe(payload);
  });
});
