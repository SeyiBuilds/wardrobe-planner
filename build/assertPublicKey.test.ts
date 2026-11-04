import { assertPublicKey } from "./assertPublicKey";

function fakeJwt(claims: object): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

describe("assertPublicKey", () => {
  it("accepts a missing key, so a fresh project can still build", () => {
    expect(() => assertPublicKey(undefined)).not.toThrow();
  });

  it("accepts a publishable key", () => {
    expect(() => assertPublicKey("sb_publishable_example")).not.toThrow();
  });

  it("accepts a legacy anon key", () => {
    expect(() => assertPublicKey(fakeJwt({ role: "anon" }))).not.toThrow();
  });

  it("rejects a secret key", () => {
    expect(() => assertPublicKey("sb_secret_example")).toThrow(/secret key/);
  });

  it("rejects a legacy service_role key", () => {
    expect(() => assertPublicKey(fakeJwt({ role: "service_role" }))).toThrow(/secret key/);
  });

  it("ignores a dotted value that isn't a real token", () => {
    expect(() => assertPublicKey("not.a.token")).not.toThrow();
  });
});
