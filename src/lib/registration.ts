import { z } from "zod";

/**
 * The shape of a registration request.
 *
 * `name` is optional, and an empty string means "not given".
 *
 * The form marks email and password `required` and leaves name alone, so the
 * product treats it as optional — but the field always posts, and an untouched
 * input posts `""`. Against a bare `z.string().min(1).optional()` that is a
 * validation error (optional admits undefined, not empty), so anyone who
 * skipped the name field got "Please check your details" pointing at nothing
 * they could see was wrong, and could not register at all. Blank is normalised
 * to undefined here rather than rejected, which is what the UI already implies.
 *
 * It lives here rather than in the route because a Next route module may only
 * export handlers, and this is worth asserting directly.
 */
export const RegistrationBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
});
