import type { ReactNode, Ref } from "react";
import type { Contact } from "@/types";
import { contactInputId, formatPhone, normalizeEmail, type ContactErrors, type ContactField } from "../contact";

/**
 * Name, phone, email and address: everything checkout requires to know who is
 * ordering and where to reach them.
 *
 * Registered email comes from the verified account. Checkout may supply an
 * onEmailChange handler for a guest's order-specific receipt destination.
 *
 * Errors are passed in already decided, so the page chooses when to show
 * them: after a first attempt to continue, not while someone is still
 * typing their name.
 */
export function ContactFields({
  contact,
  onChange,
  errors,
  email,
  emailHint,
  emailAction,
  onEmailChange,
  emailError,
  addressLabel = "Address",
  addressHint,
  addressAutocomplete = false,
  addressInputRef,
  showAddress = true,
  disabled = false,
  columns = false,
}: {
  contact: Contact;
  onChange: (contact: Contact) => void;
  errors: ContactErrors;
  email: string;
  emailHint?: ReactNode;
  /** Something to do to this address -- changing it -- beside its label,
   *  where the address it acts on is. */
  emailAction?: ReactNode;
  onEmailChange?: (email: string) => void;
  emailError?: string;
  addressLabel?: string;
  /** Replaced by the address's error when there is one. */
  addressHint?: ReactNode;
  /** Use a single-line input so Google Places can attach suggestions. */
  addressAutocomplete?: boolean;
  addressInputRef?: Ref<HTMLInputElement>;
  showAddress?: boolean;
  disabled?: boolean;
  /** Name and phone side by side from 640px, the address across the full
   *  width. For a page with room, such as the profile. */
  columns?: boolean;
}) {
  const set = (field: ContactField) => (value: string) => onChange({ ...contact, [field]: value });

  return (
    <div className={columns ? "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2" : "flex flex-col gap-4"}>
      <Field
        field="full_name"
        label="Name"
        value={contact.full_name}
        error={errors.full_name}
        onChange={set("full_name")}
        disabled={disabled}
        autoComplete="name"
        maxLength={160}
      />
      <Field
        field="phone"
        label="Phone number"
        value={formatPhone(contact.phone)}
        error={errors.phone}
        onChange={(value) => set("phone")(formatPhone(value))}
        disabled={disabled}
        autoComplete="tel"
        type="tel"
        inputMode="tel"
        maxLength={32}
        hint="The restaurant or your driver will call this if something comes up."
      />
      <label className={`block ${columns ? "sm:col-start-1" : ""}`}>
        <span className="flex items-baseline justify-between gap-3">
          <span className="label">Email</span>
          {emailAction}
        </span>
        <input
          className="field mt-[7px]"
          type="email"
          id="contact-email"
          value={email}
          onChange={onEmailChange ? e => onEmailChange(e.target.value) : undefined}
          onBlur={onEmailChange ? e => onEmailChange(normalizeEmail(e.target.value)) : undefined}
          readOnly={!onEmailChange}
          disabled={disabled || !onEmailChange}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={320}
          aria-invalid={emailError ? true : undefined}
          aria-describedby="contact-email-hint"
        />
        {(emailError || emailHint) && (
          <span id="contact-email-hint" className={emailError ? "mt-2 block text-caption text-danger" : "field-hint block"} role={emailError ? "alert" : undefined}>
            {emailError || emailHint}
          </span>
        )}
      </label>
      {showAddress && (
        <Field
          field="address"
          label={addressLabel}
          value={contact.address}
          error={errors.address}
          onChange={set("address")}
          disabled={disabled}
          autoComplete="street-address"
          maxLength={300}
          hint={addressHint}
          multiline={!addressAutocomplete}
          inputRef={addressInputRef}
          className={columns ? "sm:col-span-2" : undefined}
        />
      )}
    </div>
  );
}

function Field({
  field,
  label,
  value,
  error,
  hint,
  onChange,
  multiline = false,
  type,
  inputMode,
  className,
  inputRef,
  ...input
}: {
  field: ContactField;
  label: string;
  value: string;
  error?: string;
  hint?: ReactNode;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled: boolean;
  autoComplete: string;
  maxLength: number;
  type?: string;
  inputMode?: "tel";
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = contactInputId(field);
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const shared = {
    id,
    className: "field mt-[7px]",
    value,
    required: true,
    "aria-required": true,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": note ? noteId : undefined,
    ...input,
  };

  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          rows={2}
          className={`${shared.className} !min-h-[64px]`}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...shared}
          ref={inputRef}
          type={type}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {note && (
        <span
          id={noteId}
          className={`mt-2 block text-caption ${error ? "text-danger" : "text-muted"}`}
          role={error ? "alert" : undefined}
        >
          {note}
        </span>
      )}
    </div>
  );
}
