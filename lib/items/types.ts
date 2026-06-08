/**
 * Items catalog domain types.
 *
 * Catalog data is persisted via host-storage; cart state is in-memory only.
 */

export interface ItemCategory {
  id: string
  name: string
}

export interface CatalogItem {
  id: string
  categoryId: string
  name: string
  /** pUSD price in plancks (6 decimals). Stored as string to round-trip safely through JSON. */
  pricePlanks: string
}

export interface CartLine {
  item: CatalogItem
  quantity: number
}

export interface Catalog {
  categories: ItemCategory[]
  items: CatalogItem[]
}
