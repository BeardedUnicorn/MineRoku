import React from 'react';
import { Box, Typography } from '@mui/material';
import { releasesSince, type AvailableUpdate } from '../services/updates';

/** Markdown's inline marks, which these notes show as plain text. */
const plain = (text: string) => text.replace(/\*\*|__|`/g, '');

/**
 * One release's notes, from the CHANGELOG's Markdown: `### ` headings,
 * `- ` items and plain lines. That is all a CHANGELOG section uses, so no
 * Markdown library is needed.
 */
function Notes({ markdown }: { markdown: string }) {
  const blocks: React.ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    const list = items;
    items = [];
    blocks.push(
      <Box component="ul" key={`list-${blocks.length}`} sx={{ mt: 0.5, mb: 1, pl: 3 }}>
        {list.map((item, index) => (
          <Typography component="li" variant="body2" key={index}>
            {plain(item)}
          </Typography>
        ))}
      </Box>
    );
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) {
      items.push(line.slice(2));
    } else if (items.length > 0 && raw.startsWith('  ') && line) {
      // An item's wrapped continuation line
      items[items.length - 1] += ` ${line}`;
    } else {
      flush();
      if (!line) continue;
      const heading = /^#{3,6} (.*)$/.exec(line);
      blocks.push(
        heading ? (
          <Typography variant="subtitle2" key={`h-${blocks.length}`} sx={{ mt: 1 }}>
            {plain(heading[1])}
          </Typography>
        ) : (
          <Typography variant="body2" key={`p-${blocks.length}`} sx={{ mb: 1 }}>
            {plain(line)}
          </Typography>
        )
      );
    }
  }
  flush();
  return <>{blocks}</>;
}

/** What each release since the running version brought, newest first. */
export default function UpdateNotes({ update }: { update: AvailableUpdate }) {
  const releases = releasesSince(update);
  if (releases.length === 0) return null;
  const several = releases.length > 1;
  return (
    <Box
      aria-label="Release notes"
      role="region"
      sx={{ mt: 2, maxHeight: 280, overflowY: 'auto', pr: 1 }}
    >
      {releases.map(({ version, notes }) => (
        <Box key={version} sx={{ mb: 1.5 }}>
          {several && (
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              {version}
            </Typography>
          )}
          <Notes markdown={notes} />
        </Box>
      ))}
    </Box>
  );
}
