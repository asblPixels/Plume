'use strict';

// Lecture statique de la source VBA (MS-OVBA). Aucun code lu n'est interprété.
const VbaProject = (() => {
  const MAX_OUTPUT = 4 * 1024 * 1024;
  const u16 = (data, offset) => data[offset] | data[offset + 1] << 8;
  const u32 = (data, offset) => (u16(data, offset) | u16(data, offset + 2) << 16) >>> 0;
  const invalid = () => new Error('Flux VBA non valide.');

  function decompress(data, offset = 0) {
    if (data[offset++] !== 1) throw invalid();
    let output = new Uint8Array(4096);
    let size = 0;
    function reserve(required) {
      if (required > MAX_OUTPUT) throw invalid();
      if (required <= output.length) return;
      const grown = new Uint8Array(Math.max(output.length * 2, required));
      grown.set(output);
      output = grown;
    }
    while (offset < data.length) {
      if (offset + 2 > data.length) throw invalid();
      const header = u16(data, offset);
      const end = offset + (header & 0xfff) + 3;
      if ((header & 0x7000) !== 0x3000 || end > data.length) throw invalid();
      offset += 2;
      const start = size;
      reserve(start + 4096);
      if (!(header & 0x8000)) {
        if (end - offset !== 4096 || size + 4096 > output.length) throw invalid();
        output.set(data.subarray(offset, end), size);
        size += 4096;
        offset = end;
        continue;
      }
      while (offset < end) {
        const flags = data[offset++];
        for (let bit = 0; bit < 8 && offset < end; bit++) {
          if (size - start >= 4096 || size >= output.length) throw invalid();
          if (!(flags & (1 << bit))) {
            output[size++] = data[offset++];
            continue;
          }
          if (offset + 2 > end || size === start) throw invalid();
          const token = u16(data, offset);
          offset += 2;
          const bits = Math.max(4, Math.ceil(Math.log2(size - start)));
          const lengthMask = 0xffff >>> bits;
          const length = (token & lengthMask) + 3;
          const distance = (token >>> (16 - bits)) + 1;
          if (distance > size - start || size + length > Math.min(start + 4096, output.length)) throw invalid();
          for (let i = 0; i < length; i++, size++) output[size] = output[size - distance];
        }
      }
    }
    return output.subarray(0, size);
  }

  function moduleRecords(data, decode) {
    // Le bloc PROJECTMODULES suit les références, dont les formats varient.
    // Vérifier sa signature, puis tous les enregistrements jusqu'au terminateur.
    for (let start = 0; start + 16 <= data.length; start++) {
      if (u16(data, start) !== 0x000f || u32(data, start + 2) !== 2 ||
          u16(data, start + 8) !== 0x0013 || u32(data, start + 10) !== 2) continue;
      let position = start + 16;
      function record(id, size) {
        if (position + 6 > data.length || u16(data, position) !== id) throw invalid();
        const length = u32(data, position + 2);
        const first = position + 6;
        position = first + length;
        if (position > data.length || (size !== undefined && size !== length)) throw invalid();
        return data.subarray(first, position);
      }
      const next = id => u16(data, position) === id;
      try {
        const modules = [];
        const count = u16(data, start + 6);
        for (let i = 0; i < count; i++) {
          let name = decode.decode(record(0x0019));
          if (next(0x0047)) name = new TextDecoder('utf-16le').decode(record(0x0047)) || name;
          const stream = decode.decode(record(0x001a));
          const wideStream = new TextDecoder('utf-16le').decode(record(0x0032));
          record(0x001c);
          record(0x0048);
          const offset = u32(record(0x0031, 4), 0);
          record(0x001e, 4);
          record(0x002c, 2);
          const type = next(0x0021) ? 0x0021 : 0x0022;
          record(type, 0);
          if (next(0x0025)) record(0x0025, 0);
          if (next(0x0028)) record(0x0028, 0);
          record(0x002b, 0);
          modules.push({ name, stream: wideStream || stream, offset });
        }
        record(0x0010, 0);
        return modules;
      } catch {
        // Une signature située dans une référence ne définit pas un module.
      }
    }
    throw invalid();
  }

  function readSources(bytes) {
    const dir = LegacyDoc.readCfb(bytes, new Set(['dir'])).dir;
    if (!dir) throw invalid();
    const records = decompress(dir);
    // Les premiers enregistrements de taille fixe précèdent PROJECTCODEPAGE.
    let position = 0, codePage = 1252;
    while (position + 6 <= records.length) {
      const id = u16(records, position);
      const length = u32(records, position + 2);
      if (id === 3 && length === 2 && position + 8 <= records.length) {
        codePage = u16(records, position + 6);
        break;
      }
      if (![1, 2, 0x14, 0x4a].includes(id)) break;
      position += 6 + length;
    }
    const labels = { 65001: 'utf-8', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 874: 'windows-874' };
    const decode = new TextDecoder(labels[codePage] || `windows-${codePage}`, { fatal: true });
    const modules = moduleRecords(records, decode);
    const streams = LegacyDoc.readCfb(bytes, new Set(modules.map(module => module.stream)));
    let total = 0;
    return modules.map(({ name, stream, offset }) => {
      try {
        if (!streams[stream]) throw invalid();
        if (total >= MAX_OUTPUT) throw invalid();
        const sourceBytes = decompress(streams[stream], offset);
        total += sourceBytes.length;
        if (total > MAX_OUTPUT) throw invalid();
        const source = decode.decode(sourceBytes);
        const procedures = Array.from(source.matchAll(/^[ \t]*(?:(?:Public|Private|Friend|Static)[ \t]+)*(?:Sub|Function|Property[ \t]+(?:Get|Let|Set))[ \t]+([^\s(]+)[ \t]*(?=\()/gim),
          match => match[1]);
        return { name, source, procedures: [...new Set(procedures)] };
      } catch {
        return { name, source: null, procedures: [] };
      }
    });
  }

  return { readSources };
})();
