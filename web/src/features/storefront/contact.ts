import type { Contact } from "@/types";

/**
 * The rules checkout holds a customer's details to, mirrored from the API's
 * ContactIn so a mistake is named beside its field instead of after a round
 * trip. The server checks again and is the one that decides.
 */

export type ContactField = keyof Contact;
export type ContactErrors = Partial<Record<ContactField, string>>;

/** Runs of whitespace become one space, as the server stores them. */
export function collapse(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

export function contactErrors(contact: Contact): ContactErrors {
  const errors: ContactErrors = {};

  if (!collapse(contact.full_name)) errors.full_name = "Enter your name.";

  const phone = collapse(contact.phone);
  const digits = phone.replace(/\D/g, "").length;
  if (!phone) {
    errors.phone = "Enter your phone number.";
  } else if (/[^0-9+\-(). ]/.test(phone) || phone.slice(1).includes("+")) {
    errors.phone = "Enter a phone number using digits only.";
  } else if (digits < 7 || digits > 15) {
    errors.phone = "Enter a phone number a driver could call.";
  }

  if (collapse(contact.address).length < 5) errors.address = "Enter your address.";

  return errors;
}

/** The order fields appear in, so the first mistake is the one focused. */
export const CONTACT_FIELDS: ContactField[] = ["full_name", "phone", "address"];

export function contactInputId(field: ContactField): string {
  return `contact-${field}`;
}
