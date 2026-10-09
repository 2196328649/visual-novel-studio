import { allUiComponents, type Project } from '../core/model';
import { pythonLiteral } from './literals';

export function createSpineRuntime(project: Project): string {
  const components = allUiComponents(project).filter(component => component.kind === 'spine');
  if (!components.length) return '';
  const assets = project.assets.filter(asset => asset.kind === 'spine');
  return `init python:
    import vns_spine
    vn_spine_assets = ${pythonLiteral(Object.fromEntries(assets.map(asset => [asset.id, asset])))}
    vn_spine_components = ${pythonLiteral(Object.fromEntries(components.map(component => [component.id, component])))}
    vns_spine.install()

default vn_spine_states = vns_spine.make_states()

label after_load:
    $ vns_spine.clear()
    return
`;
}
