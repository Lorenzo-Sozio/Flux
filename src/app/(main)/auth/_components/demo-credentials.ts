/**
 * The demo account shown on the sign-in page, and the one way to fill it in.
 *
 * ⚠️⚠️ This pair is **public**: it is printed on the sign-in page of any deployment
 * that sets `DEMO_CREDENTIALS=1`, with a button that types it into the form. It is
 * therefore not a credential but an invitation, and the account behind it must be a
 * demonstration account on demonstration data — never one that can reach a real
 * customer's workspace. A deployment with real customers does not set the flag.
 */
export const DEMO_EMAIL = "admin@flux.local";
export const DEMO_PASSWORD = "admin12345";

/**
 * The banner and the form are separate components under a server page, so the fill
 * travels as an event rather than as a prop. Setting the inputs' `value` from outside
 * would not work: the form keeps its own state and never hears a value assigned to
 * the DOM node — the field would look filled and submit empty.
 */
export const DEMO_FILL_EVENT = "flux:fill-demo-credentials";

export interface DemoCredentials {
  email: string;
  password: string;
}

export function requestDemoFill(): void {
  window.dispatchEvent(
    new CustomEvent<DemoCredentials>(DEMO_FILL_EVENT, { detail: { email: DEMO_EMAIL, password: DEMO_PASSWORD } }),
  );
}
