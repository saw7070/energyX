/**
 * Plain words for each recorded audit event, for the Organisation Activity page and its CSV export. The web app's
 * admin audit history keeps its own copy (apps/web/src/app/energyiq/admin/audit-history.tsx); anything not listed
 * still reads sensibly, built from its technical name.
 */
export const AUDIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  "auth.login_succeeded": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.login_unverified": "Sign-in blocked: email not verified",
  "auth.logout": "Signed out",
  "auth.logout_all": "Signed out on every device",
  "auth.session_created": "Started a session",
  "auth.password_changed": "Changed their password",
  "auth.password_reset_requested": "Asked for a password reset",
  "auth.password_reset_requested_unknown": "Password reset asked for an unknown email",
  "auth.password_reset_completed": "Reset their password",
  "auth.invitation_created": "Invitation sent",
  "auth.invitation_resent": "Invitation sent again",
  "auth.invitation_accepted": "Accepted an invitation",
  "auth.email_verified": "Verified their email",
  "energyiq.user_updated": "Changed a user's account or access",
  "energyiq.user_access_assigned": "Gave a user access",
  "energyiq.user_personal_data_exported": "Exported a person's personal data",
  "energyiq.user_erased": "Erased a person's personal data",
  "energyiq.team_member_invited": "Invited a team member",
  "energyiq.team_member_removed": "Removed a team member",
  "energyiq.team_invitation_resent": "Sent a team invitation again",
  "energyiq.role_created": "Created a role",
  "energyiq.role_updated": "Changed a role",
  "energyiq.role_deleted": "Deleted a role",
  "energyiq.organisation_created": "Created the Organisation",
  "energyiq.organisation_updated": "Changed the Organisation's name or status",
  "energyiq.organisation_deleted": "Deleted the Organisation",
  "energyiq.project_created": "Created a project",
  "energyiq.project_archived": "Archived a project",
  "energyiq.project_restored": "Restored a project",
  "energyiq.project_deleted": "Deleted a project",
  "energyiq.project_moved": "Moved a project between clients",
  "energyiq.electricity_rate_published": "Changed the electricity rate",
  "energyiq.hours_holidays_published": "Changed opening hours or holidays",
  "energyiq.policy_version_selected": "Switched the rate or hours version in use",
  "energyiq.setup_published": "Published facility setup",
  "energyiq.changes_made_live": "Made facility changes live",
  "energyiq.setup_draft_saved": "Saved facility changes",
  "energyiq.data_import_changed": "Uploaded or changed meter data",
  "energyiq.live_connection_changed": "Changed the live meter connection",
  "energyiq.locations_changed": "Changed locations",
  "energyiq.analysis_rules_changed": "Changed analysis rules",
  "energyiq.overview_layout_changed": "Changed the Overview layout",
  "energyiq.budget_carbon_changed": "Changed a site's budget, carbon factor or overnight check",
  "energyiq.report_schedule_changed": "Changed a scheduled report email",
  "energyiq.report_email_sent": "Sent a scheduled report email",
  "energyiq.ai_used": "Used AI",
  "energyiq.ai_blocked": "AI request refused",
  "energyiq.ai_settings_changed": "Changed AI settings",
  "energyiq.platform_config_changed": "Changed a platform setting",
  "energyiq.audit_retention_applied": "Removed audit records past the retention period",
};

const ACRONYMS = new Set(["ai", "api", "csv", "ip", "mfa", "scim", "sso", "totp"]);

/** "auth.mfa_enabled" becomes "MFA enabled" for an event this list does not know yet. */
const fromTechnicalName = (type: string): string => {
  const words = (type.split(".").at(-1) ?? type).split("_").filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()));
  const sentence = words.join(" ");
  return sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : type;
};

export const auditEventLabel = (type: string, metadata: Record<string, unknown> = {}): string => {
  if (type === "energyiq.support_access") {
    return metadata.access === "change" ? "EnergyX support changed your data" : "EnergyX support looked at your data";
  }
  return AUDIT_EVENT_LABELS[type] ?? fromTechnicalName(type);
};
