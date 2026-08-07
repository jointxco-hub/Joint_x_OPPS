import assert from "node:assert/strict";
import test from "node:test";
import {
  getOrderGalleryEntries,
  getOrderOtherFiles,
  getOrderThumbnail,
  thumbnailPatchOnRemove,
} from "../src/lib/orderThumbnail.js";

test("manual pin wins outright over everything else", () => {
  const order = {
    production_thumbnail_url: "https://x.test/pinned.jpg",
    file_urls: ["https://x.test/pinned.jpg", "https://x.test/mockup.jpg"],
    order_file_folders: { fileFolders: { "https://x.test/mockup.jpg": "mockups" } },
  };
  // pinned.jpg is unfoldered (would rank behind the Mockups-tagged image on
  // pure priority) but wins anyway because it's explicitly pinned.
  assert.equal(getOrderThumbnail(order), "https://x.test/pinned.jpg");
});

test("a pin pointing at a non-image URL is ignored, falls back to normal priority", () => {
  const order = {
    production_thumbnail_url: "https://x.test/not-an-image.pdf",
    file_urls: ["https://x.test/mockup.jpg"],
    order_file_folders: { fileFolders: { "https://x.test/mockup.jpg": "mockups" } },
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/mockup.jpg");
});

test("unpinned order falls back to gallery priority (no pin field)", () => {
  const order = {
    file_urls: ["https://x.test/only.jpg"],
    order_file_folders: { fileFolders: {} },
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/only.jpg");
});

test("explicit unpin (clearThumbnail sets production_thumbnail_url to null) falls back to automatic selection", () => {
  const pinned = {
    production_thumbnail_url: "https://x.test/pinned.jpg",
    file_urls: ["https://x.test/pinned.jpg", "https://x.test/mockup.jpg"],
    order_file_folders: { fileFolders: { "https://x.test/mockup.jpg": "mockups" } },
  };
  assert.equal(getOrderThumbnail(pinned), "https://x.test/pinned.jpg");

  // Simulates OrderFilesTab's clearThumbnail(): production_thumbnail_url -> null
  const afterUnpin = { ...pinned, production_thumbnail_url: null };
  assert.equal(getOrderThumbnail(afterUnpin), "https://x.test/mockup.jpg");
});

// removeFileLink in OrderFilesTab.jsx does NOT clear production_thumbnail_url
// when the pinned file itself is unlinked/deleted from the order — so this is
// the real-world failure mode, distinct from the explicit-unpin case above:
// the DB row keeps a dangling reference to a file the order no longer has.
test("stale pinned reference (file removed from the order, DB field not cleared) is ignored, falls back through Mockups -> unsorted -> other priority", () => {
  const order = {
    production_thumbnail_url: "https://x.test/image-a-since-removed.jpg",
    file_urls: ["https://x.test/unsorted-c.jpg", "https://x.test/mockup-b.jpg"],
    order_file_folders: { fileFolders: { "https://x.test/mockup-b.jpg": "mockups" } },
  };
  assert.doesNotThrow(() => getOrderThumbnail(order));
  assert.equal(getOrderThumbnail(order), "https://x.test/mockup-b.jpg");
});

test("stale pinned reference with only an other-folder image remaining still falls back correctly", () => {
  const order = {
    production_thumbnail_url: "https://x.test/image-a-since-removed.jpg",
    file_urls: ["https://x.test/artwork-only.jpg"],
    order_file_folders: { fileFolders: { "https://x.test/artwork-only.jpg": "artwork" } },
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/artwork-only.jpg");
});

test("stale pinned reference with zero remaining images returns empty string, does not throw or return the dead reference", () => {
  const order = {
    production_thumbnail_url: "https://x.test/image-a-since-removed.jpg",
    file_urls: [],
  };
  assert.doesNotThrow(() => getOrderThumbnail(order));
  assert.equal(getOrderThumbnail(order), "");
});

test("Mockups-folder image wins over unsorted and other-folder images", () => {
  const order = {
    file_urls: ["https://x.test/unsorted.jpg", "https://x.test/artwork.jpg", "https://x.test/mockup.jpg"],
    order_file_folders: {
      fileFolders: {
        "https://x.test/artwork.jpg": "artwork",
        "https://x.test/mockup.jpg": "mockups",
      },
    },
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/mockup.jpg");
});

test("with no Mockups file, first unsorted (unfoldered) image wins over named folders", () => {
  const order = {
    file_urls: ["https://x.test/artwork.jpg", "https://x.test/loose.jpg"],
    order_file_folders: {
      fileFolders: { "https://x.test/artwork.jpg": "artwork" },
    },
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/loose.jpg");
});

test("with no Mockups and no unsorted image, first other-folder image wins", () => {
  const order = {
    file_urls: ["https://x.test/artwork.jpg"],
    order_file_folders: {
      fileFolders: { "https://x.test/artwork.jpg": "artwork" },
    },
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/artwork.jpg");
});

test("falls back to portal_visible_file_urls when file_urls has no images", () => {
  const order = {
    file_urls: [],
    portal_visible_file_urls: ["https://x.test/tracker-visible.jpg"],
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/tracker-visible.jpg");
});

test("falls back to product images as last resort", () => {
  const order = {
    file_urls: [],
    portal_visible_file_urls: [],
    products: [{ image_url: "https://x.test/product.jpg" }],
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/product.jpg");
});

test("no thumbnail and no files at all: returns empty string, does not throw", () => {
  const order = {};
  assert.equal(getOrderThumbnail(order), "");
  assert.deepEqual(getOrderGalleryEntries(order), []);
  assert.deepEqual(getOrderOtherFiles(order), []);
});

test("gallery entries de-duplicate the same URL across categories, keeping first label", () => {
  const order = {
    file_urls: ["https://x.test/dupe.jpg"],
    order_file_folders: { fileFolders: { "https://x.test/dupe.jpg": "mockups" } },
    portal_visible_file_urls: ["https://x.test/dupe.jpg"],
  };
  const entries = getOrderGalleryEntries(order);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, "Mockup");
});

test("getOrderOtherFiles returns only non-image files (PDFs etc.), images excluded", () => {
  const order = {
    file_urls: ["https://x.test/spec.pdf", "https://x.test/mockup.jpg", "https://x.test/tech-pack.docx"],
  };
  const others = getOrderOtherFiles(order);
  assert.deepEqual(others.sort(), ["https://x.test/spec.pdf", "https://x.test/tech-pack.docx"].sort());
});

test("extraCount / orderedGallery composition matches what ProductionSummaryOrderCard expects", () => {
  const order = {
    production_thumbnail_url: "https://x.test/pinned.jpg",
    file_urls: ["https://x.test/pinned.jpg", "https://x.test/mockup.jpg", "https://x.test/spec.pdf"],
    order_file_folders: { fileFolders: { "https://x.test/mockup.jpg": "mockups" } },
  };
  const thumb = getOrderThumbnail(order);
  const galleryEntries = getOrderGalleryEntries(order);
  const otherFiles = getOrderOtherFiles(order);
  const orderedGallery = thumb
    ? [{ url: thumb, label: "Thumbnail" }, ...galleryEntries.filter((entry) => entry.url !== thumb)]
    : galleryEntries;
  const extraImages = orderedGallery.slice(1);
  const extraCount = extraImages.length + otherFiles.length;

  assert.equal(thumb, "https://x.test/pinned.jpg");
  assert.equal(orderedGallery.length, 2);
  assert.equal(extraCount, 2);
});

// thumbnailPatchOnRemove backs OrderFilesTab's removeFileLink: it returns the
// production_thumbnail_url patch to merge into that same order-update call,
// so unlinking the pinned file clears the pin in one mutation instead of a
// second request.

test("removing the pinned image returns a patch that clears the pin", () => {
  const patch = thumbnailPatchOnRemove("https://x.test/pinned.jpg", "https://x.test/pinned.jpg");
  assert.deepEqual(patch, { production_thumbnail_url: null });
});

test("removing a different (non-pinned) image returns an empty patch, pin is left untouched", () => {
  const patch = thumbnailPatchOnRemove("https://x.test/other.jpg", "https://x.test/pinned.jpg");
  assert.deepEqual(patch, {});
});

test("null/no-pin state is safe: nothing is pinned, removing any file returns an empty patch", () => {
  assert.deepEqual(thumbnailPatchOnRemove("https://x.test/other.jpg", ""), {});
  assert.deepEqual(thumbnailPatchOnRemove("https://x.test/other.jpg", null), {});
  assert.deepEqual(thumbnailPatchOnRemove(null, null), {});
  assert.deepEqual(thumbnailPatchOnRemove("", ""), {});
});

test("end-to-end: after the pin-clearing patch is applied, thumbnail resolution falls back through Mockups -> unsorted -> other image", () => {
  const order = {
    production_thumbnail_url: "https://x.test/pinned.jpg",
    file_urls: ["https://x.test/pinned.jpg", "https://x.test/mockup.jpg"],
    order_file_folders: { fileFolders: { "https://x.test/mockup.jpg": "mockups" } },
  };
  assert.equal(getOrderThumbnail(order), "https://x.test/pinned.jpg");

  // Simulates removeFileLink removing the pinned file: file_urls loses it,
  // and thumbnailPatchOnRemove's patch is merged into the same update.
  const patch = thumbnailPatchOnRemove("https://x.test/pinned.jpg", order.production_thumbnail_url);
  const afterRemoval = {
    ...order,
    file_urls: order.file_urls.filter((url) => url !== "https://x.test/pinned.jpg"),
    ...patch,
  };
  assert.equal(afterRemoval.production_thumbnail_url, null);
  assert.equal(getOrderThumbnail(afterRemoval), "https://x.test/mockup.jpg");
});
