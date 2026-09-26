/**
 * Browser-side WebAuthn (passkey) helpers.
 *
 * The backend hands us JSON options with base64url-encoded binary fields;
 * the WebAuthn API needs ArrayBuffers. This module handles the marshalling
 * plus the two ceremonies (enrol + unlock) end-to-end.
 *
 * ``isBiometricSupported()`` should be checked before rendering the UI so
 * we never nag on browsers that can't do platform authenticators (Firefox
 * mobile, older Chromes, etc.).
 */
import api from "@/lib/api";

/* ---------- Base64url ↔ Uint8Array ---------- */
export function b64uToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function bytesToB64u(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** True when the browser + platform can do a platform-authenticator ceremony. */
export async function isBiometricSupported() {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch { return false; }
}

/* ---------- Serialise a browser Credential for the backend ---------- */
function jsonCredential(cred) {
  const r = cred.response;
  const isAttestation = typeof r.attestationObject !== "undefined";
  return {
    id: cred.id,
    rawId: bytesToB64u(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment,
    response: isAttestation
      ? {
        clientDataJSON: bytesToB64u(r.clientDataJSON),
        attestationObject: bytesToB64u(r.attestationObject),
        transports: r.getTransports?.() || ["internal"],
      }
      : {
        clientDataJSON: bytesToB64u(r.clientDataJSON),
        authenticatorData: bytesToB64u(r.authenticatorData),
        signature: bytesToB64u(r.signature),
        userHandle: r.userHandle ? bytesToB64u(r.userHandle) : null,
      },
  };
}

/* ---------- Ceremonies ---------- */
export async function enrolPasskey() {
  const { data } = await api.post("/webauthn/register/begin");
  const opts = data.options;
  const publicKey = {
    ...opts,
    challenge: b64uToBytes(opts.challenge),
    user: { ...opts.user, id: b64uToBytes(opts.user.id) },
    excludeCredentials: (opts.excludeCredentials || []).map((x) => ({
      ...x, id: b64uToBytes(x.id),
    })),
  };
  const cred = await navigator.credentials.create({ publicKey });
  if (!cred) throw new Error("No credential returned by browser");
  const payload = jsonCredential(cred);
  return api.post("/webauthn/register/finish", {
    credential: payload,
    challenge_id: data.challenge_id,
  });
}

export async function unlockWithBiometric() {
  const { data } = await api.post("/webauthn/auth/begin");
  const opts = data.options;
  const publicKey = {
    ...opts,
    challenge: b64uToBytes(opts.challenge),
    allowCredentials: (opts.allowCredentials || []).map((x) => ({
      ...x, id: b64uToBytes(x.id),
    })),
    userVerification: "required",
  };
  const assertion = await navigator.credentials.get({ publicKey });
  if (!assertion) throw new Error("No assertion returned by browser");
  const payload = jsonCredential(assertion);
  return api.post("/webauthn/auth/finish", {
    credential: payload,
    challenge_id: data.challenge_id,
  });
}

export async function disableBiometric() {
  return api.delete("/webauthn/credentials");
}

/* Passwordless sign-in from the login screen (email-first). Returns access_token. */
export async function passkeyLogin(email) {
  const { data } = await api.post("/webauthn/login/begin", { email });
  const opts = data.options;
  const publicKey = {
    ...opts,
    challenge: b64uToBytes(opts.challenge),
    allowCredentials: (opts.allowCredentials || []).map((x) => ({ ...x, id: b64uToBytes(x.id) })),
    userVerification: "required",
  };
  const assertion = await navigator.credentials.get({ publicKey });
  if (!assertion) throw new Error("No assertion returned by browser");
  const { data: res } = await api.post("/webauthn/login/finish", {
    email,
    credential: jsonCredential(assertion),
    challenge_id: data.challenge_id,
  });
  return res.access_token;
}
