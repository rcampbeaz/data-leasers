// A one-to-many embed comes back as an array, but the shape is decided by the query and the
// PostgREST version rather than by us, and a single row can arrive unwrapped. Reading an
// embed through this makes "no rows" mean no rows, so a used asset cannot look unused and a
// delete guard cannot be talked into letting it go.
//
// The row type is passed explicitly: given a union of "array or single", inference widens to
// include the array itself, which would hand back rows of the wrong shape.
export function embeddedRows<T>(value: unknown): T[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}
