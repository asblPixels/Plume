'use strict';
importScripts('../vendor/jszip.min.js', 'office-archive.js');
self.onmessage = async ({ data }) => {
  try {
    await OfficeArchive.verify(data);
    self.postMessage({ ok: true });
  } catch (error) {
    self.postMessage({ ok: false, error: error.message });
  }
};
