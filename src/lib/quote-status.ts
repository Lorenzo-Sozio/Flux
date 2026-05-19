export const QUOTE_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-slate-300 text-slate-600" },
  pending_approval: { label: "In attesa di approvazione", className: "border-orange-300 text-orange-600 bg-orange-50" },
  sent: { label: "Sent", className: "border-blue-300 text-blue-600 bg-blue-50" },
  viewed: { label: "Viewed", className: "border-violet-300 text-violet-600 bg-violet-50" },
  accepted: { label: "Accepted", className: "border-green-300 text-green-600 bg-green-50" },
  declined: { label: "Declined", className: "border-red-300 text-red-600 bg-red-50" },
  expired: { label: "Expired", className: "border-amber-300 text-amber-600 bg-amber-50" },
  converted: { label: "Converted", className: "border-teal-300 text-teal-600 bg-teal-50" },
};
