/**
 * Business row → API profile.
 *
 * The address is stored flat (one table, no join for a single address) but
 * presented nested, so the frontend form maps one-to-one onto the contract in
 * `planning/feature0.md`.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import type {
  BusinessProfile,
  BusinessRecord,
} from "../types/business.types.js";

export function toBusinessProfile(record: BusinessRecord): BusinessProfile {
  return {
    id: record.id,
    legalName: record.legalName,
    tradingName: record.tradingName,
    businessType: record.businessType,
    registrationNumber: record.registrationNumber,
    industry: record.industry,
    description: record.description,
    email: record.email,
    phone: record.phone,
    website: record.website,
    address: {
      line1: record.addressLine1,
      line2: record.addressLine2,
      city: record.city,
      state: record.state,
      postalCode: record.postalCode,
      country: record.country,
    },
    currency: record.currency,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
