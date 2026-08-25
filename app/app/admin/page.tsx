// /admin — the access-request queue. The page is a thin shell; AdminAccess (a
// client component) does the signed fetch and the approve/deny actions. Access
// is enforced server-side on /api/admin/access (signature + ADMIN_ADDRESSES),
// so this route rendering never grants anything on its own.

import type { Metadata } from "next";
import AdminAccess from "@/components/AdminAccess";

export const metadata: Metadata = {
  title: "Admin · Access requests",
};

export default function AdminPage() {
  return <AdminAccess />;
}
