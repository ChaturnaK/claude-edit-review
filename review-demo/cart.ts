export type Item = { name: string; price: number; qty: number }

export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0)
}

export function describe(items: Item[]): string {
  return `${items.length} items, total ${total(items)}`
}
