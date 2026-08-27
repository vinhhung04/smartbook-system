import { useState } from "react";
import { pickCategoryStyle } from "./catalog-book-category";

export function CatalogBookThumbnail({ category, title, imageUrl }: { category?: string | null; title: string; imageUrl?: string | null }) {
  const style = pickCategoryStyle(category);
  const [imgError, setImgError] = useState(false);

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={title}
        className="h-11 w-8 shrink-0 rounded-md border border-border object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className={`flex h-11 w-8 shrink-0 items-center justify-center rounded-md border border-border ${style.bgClass}`}>
      <style.Icon className={`h-4 w-4 ${style.iconClass}`} />
    </div>
  );
}
