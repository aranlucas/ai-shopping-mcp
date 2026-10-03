/** JSON fixture inputs preserve explicit undefined so JSON.stringify controls omission. */
export type JsonInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput };
