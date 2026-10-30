import { randomUUID } from "node:crypto";
import type {
  MetadataStore,
  OrganisationScimTokenRecord,
  OrganisationScimUserRecord,
  UserRecord,
  WorkspaceMembershipRecord,
  WorkspaceRecord
} from "@datafoundry/metadata";

import { customerOrganisationIds, isPlatformSuperAdmin } from "../auth/sso-policy.js";

/**
 * SCIM 2.0 user provisioning for one Organisation (RFC 7643 / 7644, the subset Microsoft Entra ID and Okta use).
 *
 * The caller is the Organisation's identity provider, authenticated by a provisioning key. The key alone decides the
 * Organisation: every lookup is confined to it, so a key can never see or change anyone else's people. Provisioned
 * people join that Organisation only, as Viewers. EnergyX super admins are never visible or changeable here.
 *
 * "Switching someone off" (active = false) takes them out of the Organisation but remembers them, so the identity
 * provider can still read them back and switch them on again with the role they had. Deleting someone removes them
 * from the Organisation. Either way, an account left with no Organisation at all is disabled and signed out.
 */
export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export type ScimErrorType =
  | "invalidFilter" | "invalidSyntax" | "invalidValue" | "invalidPath" | "uniqueness" | "mutability" | "tooMany";

export class ScimError extends Error {
  constructor(readonly status: number, readonly scimType: ScimErrorType | undefined, detail: string) {
    super(detail);
    this.name = "ScimError";
  }

  toBody(): Record<string, unknown> {
    return {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(this.status),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.message
    };
  }
}

export type ScimCaller = { key: OrganisationScimTokenRecord; organisation: WorkspaceRecord; baseUrl: string };

type ScimEntry = { user: UserRecord; membership?: WorkspaceMembershipRecord; link?: OrganisationScimUserRecord };

type ScimUserChanges = {
  userName?: string;
  email?: string;
  externalId?: string | null;
  displayName?: string;
  active?: boolean;
};

const MAX_PAGE = 200;
const DEFAULT_PAGE = 100;
const KEY_TOUCH_INTERVAL_MS = 60 * 1000;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

export class ScimService {
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;

  constructor(private readonly dependencies: {
    metadataStore: MetadataStore;
    /** The same keyed hash the settings page stored the provisioning key under. */
    hashKey: (key: string) => string;
    env?: Record<string, string | undefined>;
    now?: () => number;
  }) {
    this.env = dependencies.env ?? process.env;
    this.now = dependencies.now ?? Date.now;
  }

  private get store(): MetadataStore {
    return this.dependencies.metadataStore;
  }

  /** The Organisation a request may act for, from its `Authorization: Bearer <provisioning key>` header only. */
  authenticate(authorization: string | undefined, baseUrl: string): ScimCaller {
    const match = /^Bearer\s+(\S+)\s*$/iu.exec(authorization ?? "");
    const key = match?.[1] ? this.store.organisationIdentity.findActiveScimTokenByHash(this.dependencies.hashKey(match[1])) : undefined;
    if (!key) throw new ScimError(401, undefined, "A valid provisioning key is required.");
    let organisation: WorkspaceRecord;
    try {
      organisation = this.store.workspaces.get({ id: key.workspace_id });
    } catch {
      throw new ScimError(401, undefined, "A valid provisioning key is required.");
    }
    if (organisation.kind !== "customer") throw new ScimError(401, undefined, "A valid provisioning key is required.");
    if (organisation.disabled_at) throw new ScimError(403, undefined, "This Organisation is switched off in EnergyX.");
    const now = this.now();
    if (!key.last_used_at || now - Date.parse(key.last_used_at) > KEY_TOUCH_INTERVAL_MS) {
      this.store.organisationIdentity.touchScimToken(key.id, new Date(now).toISOString());
    }
    return { key, organisation, baseUrl };
  }

  // --- Discovery ------------------------------------------------------------------------------------------------

  serviceProviderConfig(caller: ScimCaller): Record<string, unknown> {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: `${caller.baseUrl}/ServiceProviderConfig`,
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_PAGE },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authentication with the Organisation's provisioning key as a bearer token.",
        primary: true
      }],
      meta: { resourceType: "ServiceProviderConfig", location: `${caller.baseUrl}/ServiceProviderConfig` }
    };
  }

  resourceTypes(caller: ScimCaller): Record<string, unknown>[] {
    return [{
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      description: "A person in this Organisation",
      schema: SCIM_USER_SCHEMA,
      meta: { resourceType: "ResourceType", location: `${caller.baseUrl}/ResourceTypes/User` }
    }];
  }

  schemas(caller: ScimCaller): Record<string, unknown>[] {
    const attribute = (name: string, extra: Record<string, unknown> = {}) => ({
      name, type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite",
      returned: "default", uniqueness: "none", ...extra
    });
    return [{
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      id: SCIM_USER_SCHEMA,
      name: "User",
      description: "A person in this Organisation",
      attributes: [
        attribute("userName", { required: true, uniqueness: "server" }),
        attribute("name", {
          type: "complex",
          subAttributes: [attribute("formatted"), attribute("givenName"), attribute("familyName")]
        }),
        attribute("displayName"),
        attribute("emails", {
          type: "complex",
          multiValued: true,
          subAttributes: [attribute("value"), attribute("type"), attribute("primary", { type: "boolean" })]
        }),
        attribute("active", { type: "boolean" }),
        attribute("externalId", { caseExact: true })
      ],
      meta: { resourceType: "Schema", location: `${caller.baseUrl}/Schemas/${SCIM_USER_SCHEMA}` }
    }];
  }

  // --- Users ----------------------------------------------------------------------------------------------------

  listUsers(caller: ScimCaller, query: { filter?: string | null; startIndex?: string | null; count?: string | null }): Record<string, unknown> {
    const match = query.filter?.trim() ? parseFilter(query.filter) : undefined;
    const startIndex = Math.max(1, Number.parseInt(query.startIndex ?? "1", 10) || 1);
    const parsedCount = Number.parseInt(query.count ?? String(DEFAULT_PAGE), 10);
    const count = Math.min(MAX_PAGE, Math.max(0, Number.isFinite(parsedCount) ? parsedCount : DEFAULT_PAGE));
    const entries = this.visibleEntries(caller.organisation.id).filter((entry) => !match || match(entry));
    const page = entries.slice(startIndex - 1, startIndex - 1 + count);
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: entries.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page.map((entry) => this.toResource(caller, entry))
    };
  }

  getUser(caller: ScimCaller, id: string): Record<string, unknown> {
    return this.toResource(caller, this.requireEntry(caller, id));
  }

  createUser(caller: ScimCaller, body: Record<string, unknown>): Record<string, unknown> {
    const changes = changesFromResource(body);
    if (!changes.userName) throw new ScimError(400, "invalidValue", "userName is required.");
    if (!changes.email) throw new ScimError(400, "invalidValue", "An email address is required, as userName or in emails.");
    const organisationId = caller.organisation.id;
    let user = this.store.users.findByEmail({ email: changes.email });
    const existingAccount = Boolean(user);
    if (user) {
      if (isPlatformSuperAdmin(this.store, user, this.env)) {
        throw new ScimError(409, "uniqueness", "This person is managed by EnergyX and cannot be provisioned.");
      }
      if (this.findEntry(organisationId, user.id)) throw new ScimError(409, "uniqueness", "A person with this userName already exists.");
      if (user.disabled_at) throw new ScimError(409, "uniqueness", "This person's EnergyX account is switched off. Ask EnergyX support.");
    } else {
      user = this.store.users.createPasswordUser({
        id: randomUUID(),
        email: changes.email,
        ...(changes.displayName ? { display_name: changes.displayName.slice(0, 80) } : {})
      });
    }
    if (!this.store.energyIq.findUserRole(user.id)) this.store.energyIq.upsertUserRole({ user_id: user.id, role: "user" });
    this.store.workspaceMemberships.upsert({ workspace_id: organisationId, user_id: user.id, role: "member", role_id: null });
    this.store.organisationIdentity.upsertScimUser({
      workspace_id: organisationId,
      user_id: user.id,
      external_id: changes.externalId ?? null,
      user_name: changes.userName,
      display_name: changes.displayName ?? null,
      active: true,
      suspended_role_id: null,
      disabled_account: false
    });
    if (existingAccount && changes.displayName) this.applyDisplayName(user, organisationId, changes.displayName);
    this.audit(caller, "energyiq.team_member_provisioned", user, { existingAccount });
    let entry = this.requireEntry(caller, user.id);
    if (changes.active === false) entry = this.deactivate(caller, entry);
    return this.toResource(caller, entry);
  }

  replaceUser(caller: ScimCaller, id: string, body: Record<string, unknown>): Record<string, unknown> {
    const entry = this.requireEntry(caller, id);
    const changes = changesFromResource(body);
    if (!changes.userName) throw new ScimError(400, "invalidValue", "userName is required.");
    return this.toResource(caller, this.applyChanges(caller, entry, { ...changes, externalId: changes.externalId ?? null }));
  }

  patchUser(caller: ScimCaller, id: string, body: Record<string, unknown>): Record<string, unknown> {
    const entry = this.requireEntry(caller, id);
    const operations = body.Operations ?? body.operations;
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new ScimError(400, "invalidSyntax", "A PATCH request needs a list of Operations.");
    }
    const changes: ScimUserChanges = {};
    const name: { formatted?: string; givenName?: string; familyName?: string } = {};
    const apply = (path: string, value: unknown, remove: boolean) => {
      switch (path.trim().toLowerCase()) {
        case "active":
          if (!remove) changes.active = parseBoolean(value);
          return;
        case "displayname":
          changes.displayName = remove ? "" : requireText(value, "displayName");
          return;
        case "name.formatted":
          name.formatted = remove ? "" : requireText(value, "name.formatted");
          return;
        case "name.givenname":
          name.givenName = remove ? "" : requireText(value, "name.givenName");
          return;
        case "name.familyname":
          name.familyName = remove ? "" : requireText(value, "name.familyName");
          return;
        case "name":
          if (remove) { name.formatted = ""; return; }
          if (!isRecord(value)) throw new ScimError(400, "invalidValue", "name must be an object.");
          for (const [key, inner] of Object.entries(value)) apply(`name.${key}`, inner, false);
          return;
        case "externalid":
          changes.externalId = remove ? null : requireText(value, "externalId");
          return;
        case "username":
          if (!remove) {
            changes.userName = requireText(value, "userName");
            if (EMAIL_PATTERN.test(changes.userName.trim())) changes.email = changes.userName.trim().toLowerCase();
          }
          return;
        default:
          // Other attributes (title, phone numbers, addresses, ...) are not kept by EnergyX and are ignored.
          return;
      }
    };
    for (const operation of operations) {
      if (!isRecord(operation)) throw new ScimError(400, "invalidSyntax", "Each operation must be an object.");
      const op = typeof operation.op === "string" ? operation.op.toLowerCase() : "";
      if (op !== "add" && op !== "replace" && op !== "remove") {
        throw new ScimError(400, "invalidSyntax", `Unsupported operation "${String(operation.op).slice(0, 20)}".`);
      }
      if (typeof operation.path === "string" && operation.path.trim()) {
        apply(operation.path, operation.value, op === "remove");
      } else if (op !== "remove" && isRecord(operation.value)) {
        for (const [path, value] of Object.entries(operation.value)) apply(path, value, false);
      } else {
        throw new ScimError(400, "invalidPath", "A remove operation needs a path.");
      }
    }
    if (changes.displayName === undefined) {
      const joined = [name.givenName, name.familyName].filter((part) => part?.trim()).join(" ").trim();
      if (name.formatted !== undefined) changes.displayName = name.formatted;
      else if (joined) changes.displayName = joined;
    }
    return this.toResource(caller, this.applyChanges(caller, entry, changes));
  }

  deleteUser(caller: ScimCaller, id: string): void {
    const entry = this.requireEntry(caller, id);
    const organisationId = caller.organisation.id;
    if (entry.membership) this.store.workspaceMemberships.remove({ workspace_id: organisationId, user_id: entry.user.id });
    this.store.organisationIdentity.deleteScimUser(organisationId, entry.user.id);
    const disabled = this.disableIfOrphaned(entry.user);
    this.audit(caller, "energyiq.team_member_deprovisioned", entry.user, { accountDisabled: disabled });
  }

  // --- Internals ------------------------------------------------------------------------------------------------

  private applyChanges(caller: ScimCaller, entry: ScimEntry, changes: ScimUserChanges): ScimEntry {
    const organisationId = caller.organisation.id;
    if (changes.email && changes.email !== entry.user.email?.toLowerCase()) {
      throw new ScimError(400, "mutability", "EnergyX cannot change a person's email address. Remove the person and add them again.");
    }
    const touched = changes.userName !== undefined || changes.externalId !== undefined || changes.displayName !== undefined;
    if (touched) {
      this.store.organisationIdentity.upsertScimUser({
        workspace_id: organisationId,
        user_id: entry.user.id,
        ...(changes.userName !== undefined ? { user_name: changes.userName } : {}),
        ...(changes.externalId !== undefined ? { external_id: changes.externalId } : {}),
        ...(changes.displayName !== undefined ? { display_name: changes.displayName || null } : {}),
        // A person first seen through SCIM (rather than invited) is active exactly when they are a member.
        ...(entry.link ? {} : { active: Boolean(entry.membership) })
      });
      if (changes.displayName) this.applyDisplayName(entry.user, organisationId, changes.displayName);
      this.audit(caller, "energyiq.team_member_updated_by_provisioning", entry.user, {
        fields: Object.keys(changes).filter((key) => key !== "active")
      });
    }
    let current = this.requireEntry(caller, entry.user.id);
    const active = Boolean(current.membership) && !current.user.disabled_at;
    if (changes.active === false && current.membership) current = this.deactivate(caller, current);
    if (changes.active === true && !active) current = this.reactivate(caller, current);
    return current;
  }

  private deactivate(caller: ScimCaller, entry: ScimEntry): ScimEntry {
    const organisationId = caller.organisation.id;
    if (entry.membership) {
      this.store.workspaceMemberships.remove({ workspace_id: organisationId, user_id: entry.user.id });
    }
    const disabled = this.disableIfOrphaned(entry.user);
    this.store.organisationIdentity.upsertScimUser({
      workspace_id: organisationId,
      user_id: entry.user.id,
      active: false,
      suspended_role_id: entry.membership?.role_id ?? entry.link?.suspended_role_id ?? null,
      disabled_account: disabled || (entry.link?.disabled_account ?? false)
    });
    this.audit(caller, "energyiq.team_member_deactivated_by_provisioning", entry.user, { accountDisabled: disabled });
    return this.requireEntry(caller, entry.user.id);
  }

  private reactivate(caller: ScimCaller, entry: ScimEntry): ScimEntry {
    const organisationId = caller.organisation.id;
    const previousRole = entry.link?.suspended_role_id;
    const roleId = previousRole && this.store.energyIq.roles.find(previousRole) ? previousRole : null;
    if (!entry.membership) {
      this.store.workspaceMemberships.upsert({ workspace_id: organisationId, user_id: entry.user.id, role: "member", role_id: roleId });
    }
    // Only an account this Organisation's provisioning switched off is switched back on; anything else stays as it is.
    const enabled = Boolean(entry.link?.disabled_account && entry.user.disabled_at);
    if (enabled) this.store.users.setDisabled({ user_id: entry.user.id, disabled: false });
    this.store.organisationIdentity.upsertScimUser({
      workspace_id: organisationId,
      user_id: entry.user.id,
      active: true,
      suspended_role_id: null,
      disabled_account: false
    });
    this.audit(caller, "energyiq.team_member_reactivated_by_provisioning", entry.user, { accountEnabled: enabled });
    return this.requireEntry(caller, entry.user.id);
  }

  /** An account that no longer belongs to any Organisation is switched off and signed out everywhere. */
  private disableIfOrphaned(user: UserRecord): boolean {
    if (user.disabled_at || customerOrganisationIds(this.store, user.id).length > 0) return false;
    this.store.users.setDisabled({ user_id: user.id, disabled: true });
    this.store.authSessions.revokeByUser({ user_id: user.id });
    return true;
  }

  /** The profile name is shared by every Organisation, so only one that has the person to itself may change it. */
  private applyDisplayName(user: UserRecord, organisationId: string, displayName: string): void {
    const organisations = customerOrganisationIds(this.store, user.id);
    if (organisations.some((id) => id !== organisationId)) return;
    const name = displayName.replace(/\s+/gu, " ").trim().slice(0, 80);
    if (name && name !== user.display_name) this.store.users.updateDisplayName({ user_id: user.id, display_name: name });
  }

  private visibleEntries(organisationId: string): ScimEntry[] {
    const ids = new Set<string>();
    for (const membership of this.store.workspaceMemberships.listByWorkspace({ workspace_id: organisationId })) {
      if (membership.role === "member") ids.add(membership.user_id);
    }
    for (const link of this.store.organisationIdentity.listScimUsers(organisationId)) ids.add(link.user_id);
    return [...ids].map((id) => this.findEntry(organisationId, id)).filter((entry): entry is ScimEntry => Boolean(entry));
  }

  /** The person as this Organisation sees them, or undefined when they are not this Organisation's to see. */
  private findEntry(organisationId: string, userId: string): ScimEntry | undefined {
    const membership = this.store.workspaceMemberships.find({ workspace_id: organisationId, user_id: userId });
    const link = this.store.organisationIdentity.findScimUser(organisationId, userId);
    if ((!membership || membership.role !== "member") && !link) return undefined;
    let user: UserRecord;
    try {
      user = this.store.users.getById({ user_id: userId });
    } catch {
      return undefined;
    }
    if (isPlatformSuperAdmin(this.store, user, this.env)) return undefined;
    return {
      user,
      ...(membership?.role === "member" ? { membership } : {}),
      ...(link ? { link } : {})
    };
  }

  private requireEntry(caller: ScimCaller, id: string): ScimEntry {
    const entry = this.findEntry(caller.organisation.id, id);
    if (!entry) throw new ScimError(404, undefined, `User ${id.slice(0, 80)} not found.`);
    return entry;
  }

  private toResource(caller: ScimCaller, entry: ScimEntry): Record<string, unknown> {
    const { user, membership, link } = entry;
    const displayName = link?.display_name ?? user.display_name;
    const lastModified = [link?.updated_at, user.updated_at].filter((value): value is string => Boolean(value)).sort().at(-1);
    return {
      schemas: [SCIM_USER_SCHEMA],
      id: user.id,
      ...(link?.external_id ? { externalId: link.external_id } : {}),
      userName: link?.user_name ?? user.email ?? user.id,
      ...(displayName ? { displayName, name: { formatted: displayName } } : {}),
      ...(user.email ? { emails: [{ value: user.email, type: "work", primary: true }] } : {}),
      active: Boolean(membership) && !user.disabled_at,
      meta: {
        resourceType: "User",
        created: link?.created_at ?? membership?.created_at ?? user.created_at,
        ...(lastModified ? { lastModified } : {}),
        location: `${caller.baseUrl}/Users/${encodeURIComponent(user.id)}`
      }
    };
  }

  private audit(caller: ScimCaller, eventType: string, target: UserRecord, extra: Record<string, unknown>): void {
    this.store.authAuditEvents.append({
      id: randomUUID(),
      event_type: eventType,
      ...(target.email ? { email: target.email } : {}),
      metadata: {
        organisationId: caller.organisation.id,
        targetUserId: target.id,
        provisioningKeyId: caller.key.id,
        provisioningKeyName: caller.key.name,
        ...extra
      }
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw new ScimError(400, "invalidValue", `${name} must be text.`);
  return value.trim().slice(0, 300);
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/iu.test(value.trim())) return value.trim().toLowerCase() === "true";
  throw new ScimError(400, "invalidValue", "active must be true or false.");
};

/** What a full User resource (POST or PUT body) asks for. */
const changesFromResource = (body: Record<string, unknown>): ScimUserChanges => {
  const userName = typeof body.userName === "string" && body.userName.trim() ? body.userName.trim().slice(0, 300) : undefined;
  const emails = Array.isArray(body.emails) ? body.emails.filter(isRecord) : [];
  const preferred = emails.find((email) => email.primary === true || email.primary === "true")
    ?? emails.find((email) => email.type === "work")
    ?? emails[0];
  const candidate = userName && EMAIL_PATTERN.test(userName) ? userName
    : typeof preferred?.value === "string" ? preferred.value.trim() : undefined;
  const name = isRecord(body.name) ? body.name : {};
  const joined = [name.givenName, name.familyName].filter((part): part is string => typeof part === "string" && Boolean(part.trim())).join(" ");
  const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim()
    : typeof name.formatted === "string" && name.formatted.trim() ? name.formatted.trim()
      : joined || undefined;
  return {
    ...(userName ? { userName } : {}),
    ...(candidate && EMAIL_PATTERN.test(candidate) ? { email: candidate.toLowerCase() } : {}),
    ...(typeof body.externalId === "string" && body.externalId.trim() ? { externalId: body.externalId.trim().slice(0, 300) } : {}),
    ...(displayName ? { displayName: displayName.slice(0, 300) } : {}),
    ...(body.active === undefined ? {} : { active: parseBoolean(body.active) })
  };
};

/** `attribute eq "value"` for userName, externalId, id and the email address; anything else is refused. */
const parseFilter = (filter: string): ((entry: ScimEntry) => boolean) => {
  const match = /^\s*([A-Za-z]+(?:\[\s*type\s+eq\s+"work"\s*\])?(?:\.[A-Za-z]+)?)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/iu.exec(filter);
  if (!match) throw new ScimError(400, "invalidFilter", "Only filters of the form userName eq \"value\" are supported.");
  const attribute = match[1]!.toLowerCase().replace(/\s+/gu, " ");
  const value = match[2]!.replace(/\\(.)/gu, "$1");
  const lower = value.toLowerCase();
  switch (attribute) {
    case "username":
      return (entry) => (entry.link?.user_name ?? entry.user.email ?? "").toLowerCase() === lower
        || (entry.user.email ?? "").toLowerCase() === lower;
    case "externalid":
      return (entry) => entry.link?.external_id === value;
    case "id":
      return (entry) => entry.user.id === value;
    case "emails.value":
    case "emails[type eq \"work\"].value":
      return (entry) => (entry.user.email ?? "").toLowerCase() === lower;
    default:
      throw new ScimError(400, "invalidFilter", `Filtering on ${match[1]!.slice(0, 40)} is not supported.`);
  }
};
