"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

interface FieldChrome {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}

function Label({
  htmlFor,
  children,
  optional,
}: {
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="flex items-baseline justify-between gap-3"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
        {children}
      </span>
      {optional ? (
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted/60">
          Optional
        </span>
      ) : null}
    </label>
  );
}

function Messages({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: string;
  error?: string;
}) {
  if (error) {
    return (
      <p
        id={`${id}-error`}
        role="alert"
        className="mt-1.5 font-mono text-[10px] leading-relaxed tracking-wide text-vermilion"
      >
        {error}
      </p>
    );
  }

  if (hint) {
    return (
      <p
        id={`${id}-hint`}
        className="mt-1.5 font-mono text-[10px] leading-relaxed tracking-wide text-ink-muted/80"
      >
        {hint}
      </p>
    );
  }

  return null;
}

const inputBase =
  "w-full appearance-none rounded-none border-0 border-b bg-transparent px-0 pb-2.5 pt-1.5 font-sans text-[15px] text-ink outline-none transition-colors duration-200 placeholder:text-ink/25 focus:border-teal focus:shadow-[inset_0_-1px_0_0_var(--teal)] disabled:opacity-50";

export interface FieldProps
  extends FieldChrome,
    Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "name"> {
  trailing?: ReactNode;
}

export function Field({
  label,
  name,
  hint,
  error,
  optional,
  trailing,
  id,
  ...props
}: FieldProps) {
  const fieldId = id ?? name;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId} optional={optional}>
        {label}
      </Label>
      <div className="relative">
        <input
          {...props}
          id={fieldId}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
          }
          className={cn(
            inputBase,
            error ? "border-vermilion" : "border-rule",
            trailing ? "pr-24" : undefined,
          )}
        />
        {trailing ? (
          <span className="absolute inset-y-0 right-0 flex items-center pb-2">
            {trailing}
          </span>
        ) : null}
      </div>
      <Messages id={fieldId} hint={hint} error={error} />
    </div>
  );
}

export interface SelectFieldProps
  extends FieldChrome,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "name"> {
  placeholder?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export function SelectField({
  label,
  name,
  hint,
  error,
  optional,
  placeholder,
  options,
  id,
  ...props
}: SelectFieldProps) {
  const fieldId = id ?? name;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId} optional={optional}>
        {label}
      </Label>
      <div className="relative">
        <select
          {...props}
          id={fieldId}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
          }
          className={cn(
            inputBase,
            "cursor-pointer pr-8",
            error ? "border-vermilion" : "border-rule",
            props.value ? "text-ink" : "text-ink/40",
          )}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 8"
          className="pointer-events-none absolute right-1 bottom-4 h-2 w-3 text-ink-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          <path d="M1 1.5 6 6.5l5-5" />
        </svg>
      </div>
      <Messages id={fieldId} hint={hint} error={error} />
    </div>
  );
}

export interface TextareaFieldProps
  extends FieldChrome,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "name"> {}

export function TextareaField({
  label,
  name,
  hint,
  error,
  optional,
  id,
  ...props
}: TextareaFieldProps) {
  const fieldId = id ?? name;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId} optional={optional}>
        {label}
      </Label>
      <textarea
        {...props}
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
        }
        className={cn(
          "min-h-24 w-full resize-none rounded-none border border-rule bg-transparent px-3 py-3 font-sans text-[15px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-teal disabled:opacity-50",
          error ? "border-vermilion" : "border-rule",
        )}
      />
      <Messages id={fieldId} hint={hint} error={error} />
    </div>
  );
}
