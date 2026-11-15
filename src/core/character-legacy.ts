import { effectiveCharacter, type Character, type Project } from './model';
import { projectGraphs } from './project-resources';

/** Old associations are read for explanation only; opening a character never materializes them. */
function characterLineage(project: Project, characterId: string): Character[] {
  const lineage: Character[] = [], seen = new Set<string>();
  let current = project.characters.find(character => character.id === characterId);
  while (current && !seen.has(current.id)) {
    lineage.push(current); seen.add(current.id);
    const parentId = current.baseCharacterId;
    current = project.characters.find(character => character.id === parentId);
  }
  return lineage;
}

export function characterDefaultExpression(project: Project, characterId: string) {
  const effective = effectiveCharacter(project, characterId);
  const configuredId = effective?.defaultExpressionId;
  const configured = effective?.expressions.find(expression => expression.id === configuredId);
  const expression = configured ?? effective?.expressions[0];
  const source = configuredId ? characterLineage(project, characterId).find(character => character.defaultExpressionId === configuredId) : undefined;
  return { expression, configuredId, source, missing: !!configuredId && !configured };
}

/** Preview a restore without adding an undefined property or changing the project. */
export function restoredCharacterDefaultExpression(project: Project, characterId: string) {
  return characterDefaultExpression({ ...project, characters: project.characters.map(character => {
    if (character.id !== characterId) return character;
    const { defaultExpressionId: _default, ...restored } = character;
    return restored;
  }) }, characterId);
}

/** Preserve the original binding even while its automatic call is disabled. */
export function characterLegacyBlueprint(project: Project, characterId: string) {
  let disabledBy: Character | undefined;
  for (const character of characterLineage(project, characterId)) {
    if (!disabledBy && character.blueprintDisabled) disabledBy = character;
    if (character.blueprintId) return {
      source: character,
      blueprintId: character.blueprintId,
      graph: projectGraphs(project).find(graph => graph.id === character.blueprintId),
      disabledBy,
      enabled: effectiveCharacter(project, characterId)?.blueprintId === character.blueprintId,
    };
  }
  return { source: undefined, blueprintId: undefined, graph: undefined, disabledBy, enabled: false };
}

/** Include indirect descendants so deletion explains the entire affected old association. */
export function characterDeletionDependents(project: Project, characterId: string): Character[] {
  return project.characters.filter(character => {
    if (character.id === characterId) return false;
    const seen = new Set<string>([character.id]);
    let currentId = character.baseCharacterId;
    while (currentId && !seen.has(currentId)) {
      if (currentId === characterId) return true;
      seen.add(currentId);
      currentId = project.characters.find(candidate => candidate.id === currentId)?.baseCharacterId;
    }
    return false;
  });
}

/** Check again inside the edit transaction; callers cannot accidentally leave dangling associations. */
export function removeUnreferencedCharacter(project: Project, characterId: string): boolean {
  if (characterDeletionDependents(project, characterId).length) return false;
  const index = project.characters.findIndex(character => character.id === characterId);
  if (index < 0) return false;
  project.characters.splice(index, 1);
  return true;
}
