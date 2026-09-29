// Simulated copy availability per variant. Holds (loans and reservations) are
// always opened at the current simulation time and processed in time order,
// so a hold is stored only by its end time: available = copies - active holds.
// copies = Infinity is the unconstrained pilot run used to calibrate stock.

class Stock {
  constructor(copiesByVariant) {
    this.copies = copiesByVariant; // Map variantId -> number (or null => unlimited)
    this.holds = new Map(); // variantId -> end times
    this.usageMs = new Map(); // variantId -> total held milliseconds (calibration)
  }

  copiesOf(variantId) {
    return this.copies ? (this.copies.get(variantId) ?? 0) : Infinity;
  }

  available(variantId, t) {
    const ends = this.holds.get(variantId);
    if (!ends) return this.copiesOf(variantId);
    const now = t.getTime();
    let active = 0;
    for (let i = ends.length - 1; i >= 0; i -= 1) {
      if (ends[i] > now) active += 1; else ends.splice(i, 1);
    }
    return this.copiesOf(variantId) - active;
  }

  hold(variantId, start, end, windowEnd) {
    if (!this.holds.has(variantId)) this.holds.set(variantId, []);
    this.holds.get(variantId).push(end.getTime());
    const clippedEnd = Math.min(end.getTime(), windowEnd.getTime());
    this.usageMs.set(variantId, (this.usageMs.get(variantId) || 0) + Math.max(0, clippedEnd - start.getTime()));
  }

  // First variant of a book with a free copy (variants in manifest order).
  availableVariant(book, t) {
    return book.variants.find((v) => this.available(v.id, t) > 0) || null;
  }
}

module.exports = { Stock };
