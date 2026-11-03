# NeoBank frontend

Next.js 16 + Tailwind + shadcn/ui dashboard. Deployed on Netlify (see
`netlify.toml`; set the site's **Base directory** to `frontend`).

## API client

`lib/api.ts` is the shared Axios instance and `lib/auth.ts` wraps the auth
routes:

```ts
import { authApi } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

try {
  const { user } = await authApi.login({ email, password });
  // user.role is OWNER | ADMIN | EMPLOYEE | OPERATIONS
} catch (error) {
  if (error instanceof ApiClientError) {
    // error.message is the API's message, error.status the HTTP status
  }
}

const me = await authApi.profile();
await authApi.logout();
```

- `NEXT_PUBLIC_API_URL` points at the API (defaults to
  `http://localhost:5000/api/v1`).
- `withCredentials` is on for the httpOnly cookie; the Bearer token returned by
  login/register is stored and attached as a fallback for cross-site deployments.
- Every request sends `x-request-id`, the same id the backend logs.
- Errors are normalised to `ApiClientError` (`status`, `isUnauthorized`), so
  components never touch Axios internals.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
