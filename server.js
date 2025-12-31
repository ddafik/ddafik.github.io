const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Content directory path
const CONTENT_DIR = path.join(__dirname, "content");

// ============================================================================
// CONTENT LOADERS - Read from Markdown files
// ============================================================================

/**
 * Parse YAML frontmatter manually (simple implementation)
 * Format: --- (yaml content) ---
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { data: {}, content: content };
  }

  const yamlContent = match[1];
  const markdownContent = match[2];

  // Simple YAML parser for our use case
  const data = parseSimpleYaml(yamlContent);

  return { data, content: markdownContent };
}

/**
 * Improved YAML parser that handles nested objects and arrays
 */
function parseSimpleYaml(yaml) {
  const lines = yaml.split(/\r?\n/);

  function getIndent(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  function parseValue(value) {
    if (!value || value === "") return null;
    value = value.trim();

    // Remove quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    // Boolean
    if (value === "true") return true;
    if (value === "false") return false;

    // Number
    if (!isNaN(value) && value !== "") {
      return Number(value);
    }

    return value;
  }

  function parseBlock(startIdx, baseIndent) {
    const result = {};
    let i = startIdx;

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith("#")) {
        i++;
        continue;
      }

      const currentIndent = getIndent(line);

      // If we've gone back to a lower indent level, we're done with this block
      if (currentIndent < baseIndent) {
        break;
      }

      // If this is at our expected indent level
      if (currentIndent === baseIndent) {
        const trimmedLine = line.trim();

        // Array item
        if (trimmedLine.startsWith("- ")) {
          // This shouldn't happen at top level normally
          i++;
          continue;
        }

        // Key-value pair
        if (trimmedLine.includes(":")) {
          const colonIdx = trimmedLine.indexOf(":");
          const key = trimmedLine.substring(0, colonIdx).trim();
          const valueStr = trimmedLine.substring(colonIdx + 1).trim();

          if (valueStr === "" || valueStr === "|" || valueStr === ">") {
            // Check what comes next
            const nextLineIdx = i + 1;
            if (nextLineIdx < lines.length) {
              const nextLine = lines[nextLineIdx];
              const nextTrimmed = nextLine.trim();
              const nextIndent = getIndent(nextLine);

              if (nextTrimmed.startsWith("- ")) {
                // It's an array
                const arrayResult = parseArray(nextLineIdx, nextIndent);
                result[key] = arrayResult.value;
                i = arrayResult.endIdx;
                continue;
              } else if (
                nextIndent > currentIndent &&
                nextTrimmed.includes(":")
              ) {
                // It's a nested object
                const objResult = parseBlock(nextLineIdx, nextIndent);
                result[key] = objResult.value;
                i = objResult.endIdx;
                continue;
              }
            }
            result[key] = "";
          } else {
            result[key] = parseValue(valueStr);
          }
        }
      }

      i++;
    }

    return { value: result, endIdx: i };
  }

  function parseArray(startIdx, baseIndent) {
    const result = [];
    let i = startIdx;

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith("#")) {
        i++;
        continue;
      }

      const currentIndent = getIndent(line);

      // If we've gone back to a lower indent level, we're done
      if (currentIndent < baseIndent) {
        break;
      }

      const trimmedLine = line.trim();

      if (currentIndent === baseIndent && trimmedLine.startsWith("- ")) {
        const afterDash = trimmedLine.substring(2).trim();

        if (afterDash.includes(":")) {
          // It's an object starting on this line
          const colonIdx = afterDash.indexOf(":");
          const key = afterDash.substring(0, colonIdx).trim();
          const valueStr = afterDash.substring(colonIdx + 1).trim();

          const obj = {};
          obj[key] = parseValue(valueStr);

          // Look for more properties of this object
          let j = i + 1;
          const objectIndent = currentIndent + 2; // Expect properties to be indented

          while (j < lines.length) {
            const propLine = lines[j];
            if (!propLine.trim() || propLine.trim().startsWith("#")) {
              j++;
              continue;
            }

            const propIndent = getIndent(propLine);
            const propTrimmed = propLine.trim();

            if (
              propIndent >= objectIndent &&
              propTrimmed.includes(":") &&
              !propTrimmed.startsWith("-")
            ) {
              const propColonIdx = propTrimmed.indexOf(":");
              const propKey = propTrimmed.substring(0, propColonIdx).trim();
              const propValue = propTrimmed.substring(propColonIdx + 1).trim();
              obj[propKey] = parseValue(propValue);
              j++;
            } else {
              break;
            }
          }

          result.push(obj);
          i = j;
          continue;
        } else if (afterDash) {
          // Simple value in array
          result.push(parseValue(afterDash));
        }
      }

      i++;
    }

    return { value: result, endIdx: i };
  }

  // Find the first non-empty, non-comment line to determine base indent
  let baseIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() && !line.trim().startsWith("#")) {
      baseIndent = getIndent(line);
      break;
    }
  }

  const parseResult = parseBlock(0, baseIndent);
  return parseResult.value;
}

function parseYamlValue(value) {
  if (!value) return "";

  // Remove quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  if (!isNaN(value) && value !== "") {
    return Number(value);
  }

  return value;
}

/**
 * Parse BibTeX file
 */
function parseBibtex(content) {
  const publications = [];
  const entryRegex = /@(\w+)\s*\{([^,]+),\s*([\s\S]*?)\n\}/g;

  let match;
  while ((match = entryRegex.exec(content)) !== null) {
    const entryType = match[1];
    const key = match[2];
    const fieldsStr = match[3];

    const entry = { key, entryType };

    // Parse fields
    const fieldRegex = /(\w+)\s*=\s*\{([^}]*)\}/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(fieldsStr)) !== null) {
      entry[fieldMatch[1].toLowerCase()] = fieldMatch[2].trim();
    }

    // Format authors
    if (entry.author) {
      entry.authors = entry.author.replace(/ and /g, ", ");
    }

    // Map to our expected format
    publications.push({
      title: entry.title || "",
      authors: entry.authors || entry.author || "",
      year: entry.year || "",
      type:
        entry.type ||
        (entryType === "inproceedings" ? "Conference" : "Journal"),
      source: entry.journal || entry.booktitle || "",
      doi: entry.doi || null,
      citations: entry.citations ? parseInt(entry.citations) : 0,
    });
  }

  return publications;
}

/**
 * Simple Markdown to HTML converter
 */
function markdownToHtml(markdown) {
  if (!markdown) return "";

  return (
    markdown
      // Bold
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      // Links
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="text-teal-600 hover:text-teal-700 hover:underline font-medium">$1</a>'
      )
      // Line breaks
      .replace(/\n/g, "<br>")
      .trim()
  );
}

/**
 * Load bio data from bio.md
 */
function loadBio() {
  try {
    const filePath = path.join(CONTENT_DIR, "bio.md");
    const content = fs.readFileSync(filePath, "utf-8");
    const { data, content: markdown } = parseFrontmatter(content);

    return {
      ...data,
      bio_html: markdownToHtml(markdown),
    };
  } catch (error) {
    console.error("Error loading bio:", error);
    return {};
  }
}

/**
 * Load positions from positions.md
 */
function loadPositions() {
  try {
    const filePath = path.join(CONTENT_DIR, "positions.md");
    const content = fs.readFileSync(filePath, "utf-8");
    const { data } = parseFrontmatter(content);

    const positions = data.jabatan || [];
    return positions.map((pos) => ({
      ...pos,
      deskripsi: markdownToHtml(pos.deskripsi),
    }));
  } catch (error) {
    console.error("Error loading positions:", error);
    return [];
  }
}

/**
 * Load contact info from contact.md
 */
function loadContact() {
  try {
    const filePath = path.join(CONTENT_DIR, "contact.md");
    const content = fs.readFileSync(filePath, "utf-8");
    const { data } = parseFrontmatter(content);

    return data;
  } catch (error) {
    console.error("Error loading contact:", error);
    return {};
  }
}

/**
 * Load publications from publications.bib
 */
function loadPublications() {
  try {
    const filePath = path.join(CONTENT_DIR, "publications.bib");
    const content = fs.readFileSync(filePath, "utf-8");
    return parseBibtex(content);
  } catch (error) {
    console.error("Error loading publications:", error);
    return [];
  }
}

// ============================================================================
// SERVE STATIC FILES
// ============================================================================
app.use(express.static(path.join(__dirname, "public")));

// ============================================================================
// API ENDPOINTS
// ============================================================================

// API endpoint for bio
app.get("/api/bio", (req, res) => {
  const bio = loadBio();
  res.json(bio);
});

// API endpoint for positions/jabatan
app.get("/api/positions", (req, res) => {
  const positions = loadPositions();
  res.json(positions);
});

// API endpoint for contact
app.get("/api/contact", (req, res) => {
  const contact = loadContact();
  res.json(contact);
});

// API endpoint for publications
app.get("/api/publications", (req, res) => {
  const publications = loadPublications();
  res.json(publications);
});

// API endpoint for all content (combined)
app.get("/api/content", (req, res) => {
  res.json({
    bio: loadBio(),
    positions: loadPositions(),
    contact: loadContact(),
    publications: loadPublications(),
  });
});

// Serve index.html for root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🎓 Prof. Dafik Website is running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`\n📁 Content files location: ${CONTENT_DIR}`);
  console.log(`   - bio.md`);
  console.log(`   - positions.md`);
  console.log(`   - contact.md`);
  console.log(`   - publications.bib\n`);
});
