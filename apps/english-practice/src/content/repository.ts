import type { CoursePack, Item, Asset, Resource, Source, Unit } from './types'

export interface AssembleCoursePackInput {
  pack: Omit<CoursePack, 'sources' | 'assets' | 'resources' | 'items' | 'units'>
  sources: Source[]
  assets: Asset[]
  resources: Resource[]
  items: Item[]
  units: Unit[]
}

export function assembleCoursePack(input: AssembleCoursePackInput): CoursePack {
  return {
    ...input.pack,
    sources: [...input.sources],
    assets: [...input.assets],
    resources: [...input.resources],
    items: [...input.items],
    units: [...input.units],
  }
}
