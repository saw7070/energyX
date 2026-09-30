type VersionedSkill = { id?: string; isDefault?: boolean };

/** The catalog preserves each resource's append-only save order. Version labels are user-defined. */
export function preferredSkillVersion<T extends VersionedSkill>(versions: readonly T[]): T | undefined {
  return versions.find(version => version.isDefault) ?? versions.at(-1);
}

export function skillVersionGroups<T extends VersionedSkill>(skills: readonly T[]): T[][] {
  const groups: T[][] = [];
  const byId = new Map<string, T[]>();
  for (const skill of skills) {
    const existing = skill.id ? byId.get(skill.id) : undefined;
    if (existing) existing.push(skill);
    else { const group = [skill]; groups.push(group); if (skill.id) byId.set(skill.id, group); }
  }
  return groups;
}
