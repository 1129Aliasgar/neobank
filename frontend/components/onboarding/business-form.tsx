"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Field, SelectField, TextareaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  BUSINESS_TYPE_OPTIONS,
  US_STATE_OPTIONS,
} from "@/lib/business-options";
import {
  businessApi,
  routeForStep,
  type BusinessType,
  type CurrentBusiness,
  type UpdateBusinessInput,
} from "@/lib/business";

const REQUIRED_FIELDS = [
  "legalName",
  "businessType",
  "email",
  "addressLine1",
  "city",
  "state",
  "postalCode",
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];
type FieldName = RequiredField | "tradingName" | "registrationNumber" | "industry" | "description" | "phone" | "website" | "addressLine2";
type FieldErrors = Partial<Record<FieldName, string>>;

interface FormState {
  legalName: string;
  tradingName: string;
  businessType: string;
  registrationNumber: string;
  industry: string;
  description: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[1-9]\d{7,14}$/;
const ZIP = /^\d{5}(-\d{4})?$/;

function initialState(current: CurrentBusiness): FormState {
  const business = current.business;

  return {
    legalName: business.legalName ?? "",
    tradingName: business.tradingName ?? "",
    businessType: business.businessType ?? "",
    registrationNumber: business.registrationNumber ?? "",
    industry: business.industry ?? "",
    description: business.description ?? "",
    email: business.email ?? "",
    phone: business.phone ?? "",
    website: business.website ?? "",
    addressLine1: business.address.line1 ?? "",
    addressLine2: business.address.line2 ?? "",
    city: business.address.city ?? "",
    state: business.address.state ?? "",
    postalCode: business.address.postalCode ?? "",
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validate(values: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (values.legalName.trim().length < 2) {
    errors.legalName = "Enter the registered legal name";
  }

  if (!values.businessType) {
    errors.businessType = "Choose the entity type";
  }

  if (!EMAIL.test(values.email.trim())) {
    errors.email = "Enter a valid email address";
  }

  if (values.phone.trim() && !PHONE.test(values.phone.trim())) {
    errors.phone = "International format, e.g. +14155550123";
  }

  if (values.website.trim() && !isHttpUrl(values.website.trim())) {
    errors.website = "Include http:// or https://";
  }

  if (!values.addressLine1.trim()) {
    errors.addressLine1 = "Enter the street address";
  }

  if (!values.city.trim()) {
    errors.city = "Enter the city";
  }

  if (!values.state) {
    errors.state = "Choose a state";
  }

  if (!ZIP.test(values.postalCode.trim())) {
    errors.postalCode = "ZIP must be 12345 or 12345-6789";
  }

  return errors;
}

/** The live count of completed required fields, shown beside the title. */
function CompletenessMeter({ values }: { values: FormState }) {
  const filled = useMemo(
    () =>
      REQUIRED_FIELDS.filter((field) => {
        const value = values[field];

        return field === "businessType" || field === "state"
          ? value.length > 0
          : value.trim().length > 0;
      }).length,
    [values],
  );

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        <span className="text-ink">{filled}</span> / {REQUIRED_FIELDS.length} required
      </span>
      <span aria-hidden="true" className="flex gap-1">
        {REQUIRED_FIELDS.map((field, index) => (
          <span
            key={field}
            className={
              index < filled
                ? "h-3 w-px bg-teal"
                : "h-3 w-px bg-rule"
            }
          />
        ))}
      </span>
    </div>
  );
}

function SectionHeading({
  index,
  title,
  note,
}: {
  index: string;
  title: string;
  note: string;
}) {
  return (
    <div className="mb-6 flex items-baseline gap-4">
      <span className="font-mono text-[10px] tracking-[0.14em] text-teal">
        {index}
      </span>
      <div>
        <h2 className="font-heading text-[1.35rem] leading-none text-ink">
          {title}
        </h2>
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted/70">
          {note}
        </p>
      </div>
    </div>
  );
}

export function BusinessForm({ current }: { current: CurrentBusiness }) {
  const router = useRouter();
  const [values, setValues] = useState<FormState>(() => initialState(current));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: FieldName, value: string) {
    setValues((state) => ({ ...state, [field]: value }));

    if (errors[field]) {
      setErrors((state) => ({ ...state, [field]: undefined }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const found = validate(values);

    if (Object.keys(found).length > 0) {
      setErrors(found);

      const first = Object.keys(found)[0];
      document.getElementById(first)?.focus();
      return;
    }

    setErrors({});
    setSubmitting(true);

    const payload: UpdateBusinessInput = {
      legalName: values.legalName.trim(),
      tradingName: values.tradingName,
      businessType: values.businessType as BusinessType,
      registrationNumber: values.registrationNumber,
      industry: values.industry,
      description: values.description,
      email: values.email.trim(),
      phone: values.phone.trim(),
      website: values.website.trim(),
      addressLine1: values.addressLine1.trim(),
      addressLine2: values.addressLine2,
      city: values.city.trim(),
      state: values.state,
      postalCode: values.postalCode.trim(),
    };

    try {
      const updated = await businessApi.update(payload);

      if (updated.onboarding.nextStep === "COMPLETE_PROFILE") {
        setFormError(
          "Saved, but the record is still incomplete. Check the required fields above.",
        );
        setSubmitting(false);
        return;
      }

      /*
       * After a decline the record stays in FIX_AND_RETRY even once corrected
       * (the closed attempt is still the latest one), so continuing means
       * opening a new attempt rather than bouncing back to the decision page.
       */
      router.replace(
        updated.onboarding.nextStep === "FIX_AND_RETRY"
          ? "/onboarding/verify"
          : routeForStep(updated.onboarding.nextStep),
      );
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "Could not save the profile. Try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-3xl">
      {formError ? (
        <Alert tone="error" label="Not saved" className="mb-7">
          {formError}
        </Alert>
      ) : null}

      <section className="mb-10">
        <SectionHeading
          index="01"
          title="The entity"
          note="As registered with the state or registry"
        />
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <Field
            label="Legal name"
            name="legalName"
            autoComplete="organization"
            placeholder="Northwind Labs LLC"
            value={values.legalName}
            onChange={(event) => update("legalName", event.target.value)}
            error={errors.legalName}
            required
          />
          <Field
            label="Trading name"
            name="tradingName"
            placeholder="Northwind"
            value={values.tradingName}
            onChange={(event) => update("tradingName", event.target.value)}
            error={errors.tradingName}
            optional
          />
          <SelectField
            label="Entity type"
            name="businessType"
            placeholder="Select entity type"
            options={BUSINESS_TYPE_OPTIONS}
            value={values.businessType}
            onChange={(event) => update("businessType", event.target.value)}
            error={errors.businessType}
            required
          />
          <Field
            label="Registration number"
            name="registrationNumber"
            placeholder="State file number"
            value={values.registrationNumber}
            onChange={(event) => update("registrationNumber", event.target.value)}
            error={errors.registrationNumber}
            optional
          />
          <Field
            label="Industry"
            name="industry"
            placeholder="Software"
            value={values.industry}
            onChange={(event) => update("industry", event.target.value)}
            error={errors.industry}
            optional
          />
          <div className="hidden sm:block" />
          <div className="sm:col-span-2">
            <TextareaField
              label="What the business does"
              name="description"
              placeholder="One or two sentences for the reviewer."
              value={values.description}
              onChange={(event) => update("description", event.target.value)}
              error={errors.description}
              optional
              maxLength={500}
            />
          </div>
        </div>
      </section>

      <section className="mb-10">
        <SectionHeading
          index="02"
          title="Registered address"
          note="US addresses only · country is fixed"
        />
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Address line 1"
              name="addressLine1"
              autoComplete="address-line1"
              placeholder="123 Market Street"
              value={values.addressLine1}
              onChange={(event) => update("addressLine1", event.target.value)}
              error={errors.addressLine1}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Address line 2"
              name="addressLine2"
              autoComplete="address-line2"
              placeholder="Suite 400"
              value={values.addressLine2}
              onChange={(event) => update("addressLine2", event.target.value)}
              error={errors.addressLine2}
              optional
            />
          </div>
          <Field
            label="City"
            name="city"
            autoComplete="address-level2"
            placeholder="San Francisco"
            value={values.city}
            onChange={(event) => update("city", event.target.value)}
            error={errors.city}
            required
          />
          <SelectField
            label="State"
            name="state"
            placeholder="Select state"
            options={US_STATE_OPTIONS}
            value={values.state}
            onChange={(event) => update("state", event.target.value)}
            error={errors.state}
            required
          />
          <Field
            label="ZIP code"
            name="postalCode"
            autoComplete="postal-code"
            inputMode="numeric"
            placeholder="94105"
            value={values.postalCode}
            onChange={(event) => update("postalCode", event.target.value)}
            error={errors.postalCode}
            required
          />
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Country
            </span>
            <div className="border-b border-rule pb-2.5 pt-1.5 font-sans text-[15px] text-ink-muted">
              United States
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <SectionHeading
          index="03"
          title="Contact"
          note="Where the review team reaches you"
        />
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <Field
            label="Business email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="ops@company.com"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            error={errors.email}
            required
          />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+14155550123"
            value={values.phone}
            onChange={(event) => update("phone", event.target.value)}
            error={errors.phone}
            optional
          />
          <div className="sm:col-span-2">
            <Field
              label="Website"
              name="website"
              type="url"
              autoComplete="url"
              placeholder="https://company.com"
              value={values.website}
              onChange={(event) => update("website", event.target.value)}
              error={errors.website}
              optional
            />
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-5 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
        <CompletenessMeter values={values} />
        <div className="w-full sm:w-64">
          <SubmitButton loading={submitting}>Save &amp; continue</SubmitButton>
        </div>
      </div>

      <p className="mt-4 max-w-lg font-mono text-[9px] leading-relaxed uppercase tracking-[0.14em] text-ink-muted/60">
        You can return to this page until verification begins. After approval,
        the legal name and entity type are locked.
      </p>
    </form>
  );
}
