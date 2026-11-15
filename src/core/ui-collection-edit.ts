import type { UiComponent } from './model';

type CollectionOptions = NonNullable<UiComponent['list']>;

/** Absence selects legacy/runtime defaults; an own undefined would serialize as Python None. */
export function setCollectionOption<K extends keyof CollectionOptions>(component: UiComponent, key: K, value: CollectionOptions[K]): void {
  if (value === undefined) {
    if (component.list) delete component.list[key];
    return;
  }
  (component.list ??= {})[key] = value;
}
