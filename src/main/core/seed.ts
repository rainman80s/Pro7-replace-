import type { Playlist } from '@shared/model'
import { library } from './library'
import { newId } from './files'

/** First-run sample content so the app is never empty (public-domain hymns). */
export async function seedIfEmpty(): Promise<void> {
  if (process.env.REACH_NO_SEED || !(await library.isEmpty())) return
  const grace = await library.create('Amazing Grace', 'song', `Verse 1
Amazing grace how sweet the sound
That saved a wretch like me

I once was lost but now am found
Was blind but now I see

Verse 2
'Twas grace that taught my heart to fear
And grace my fears relieved

How precious did that grace appear
The hour I first believed

Verse 3
When we've been there ten thousand years
Bright shining as the sun

We've no less days to sing God's praise
Than when we'd first begun`)
  grace.meta = { author: 'John Newton', copyright: 'Public Domain', category: 'Hymns' }
  grace.arrangements = [{ id: newId(), name: 'Default', groupIds: grace.groups.map((g) => g.id) }]
  grace.activeArrangementId = grace.arrangements[0].id
  await library.save(grace)

  const dox = await library.create('Doxology', 'song', `Verse
Praise God from whom all blessings flow
Praise Him all creatures here below

Praise Him above ye heavenly host
Praise Father Son and Holy Ghost

Ending
Amen`)
  dox.meta = { author: 'Thomas Ken', copyright: 'Public Domain', category: 'Hymns' }
  await library.save(dox)

  const welcome = await library.create('Welcome', 'generic', 'Welcome to Reach\n\nWe\'re glad you\'re here')
  const pl: Playlist = {
    id: newId(), name: 'Sample Sunday', updatedAt: '',
    items: [
      { id: newId(), type: 'header', title: 'Pre-Service' },
      { id: newId(), type: 'presentation', presentationId: welcome.id },
      { id: newId(), type: 'header', title: 'Worship' },
      { id: newId(), type: 'presentation', presentationId: grace.id },
      { id: newId(), type: 'presentation', presentationId: dox.id },
      { id: newId(), type: 'header', title: 'Message' },
      { id: newId(), type: 'placeholder', title: 'Sermon', hint: 'Pull from Notion' }
    ]
  }
  await library.savePlaylist(pl)
}
