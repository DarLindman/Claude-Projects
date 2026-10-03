// Meal thumbnails. The server stores one small JPEG per meal and serves it to its owner.
export function photoSrc(id) { return `/api/food/${id}/photo`; }
