import { Button } from '@/components/ui/button'
import { PICTURE_EVENT_KIND } from '@/constants'
import { useFetchRelayInfos } from '@/hooks'
import { isReplyNoteEvent } from '@/lib/event'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import client from '@/services/client.service'
import dayjs from 'dayjs'
import { Event, Filter, kinds } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from 'react-simple-pull-to-refresh'
import NoteCard from '../NoteCard'
import PictureNoteCard from '../PictureNoteCard'
import SimpleMasonryGrid from '../SimpleMasonryGrid'

const NORMAL_RELAY_LIMIT = 100
const ALGO_RELAY_LIMIT = 500
const PICTURE_NOTE_LIMIT = 30

type TListMode = 'posts' | 'postsAndReplies' | 'pictures'

export default function NoteList({
  relayUrls,
  filter = {},
  className
}: {
  relayUrls: string[]
  filter?: Filter
  className?: string
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { signEvent, checkLogin } = useNostr()
  const { isFetching: isFetchingRelayInfo, areAlgoRelays } = useFetchRelayInfos([...relayUrls])
  const [refreshCount, setRefreshCount] = useState(0)
  const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
  const [events, setEvents] = useState<Event[]>([])
  const [newEvents, setNewEvents] = useState<Event[]>([])
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState(true)
  const [listMode, setListMode] = useState<TListMode>('posts')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const isPictures = useMemo(() => listMode === 'pictures', [listMode])
  const noteFilter = useMemo(() => {
    if (isPictures) {
      return {
        kinds: [PICTURE_EVENT_KIND],
        limit: PICTURE_NOTE_LIMIT,
        ...filter
      }
    }
    return {
      kinds: [kinds.ShortTextNote, kinds.Repost, PICTURE_EVENT_KIND],
      limit: areAlgoRelays ? ALGO_RELAY_LIMIT : NORMAL_RELAY_LIMIT,
      ...filter
    }
  }, [JSON.stringify(filter), areAlgoRelays, isPictures])

  useEffect(() => {
    if (isFetchingRelayInfo || relayUrls.length === 0) return

    async function init() {
      setRefreshing(true)
      setEvents([])
      setNewEvents([])
      setHasMore(true)

      let eventCount = 0
      const { closer, timelineKey } = await client.subscribeTimeline(
        [...relayUrls],
        noteFilter,
        {
          onEvents: (events, eosed) => {
            if (eventCount > events.length) return
            eventCount = events.length

            if (events.length > 0) {
              setEvents(events)
            }
            if (areAlgoRelays) {
              setHasMore(false)
            }
            if (eosed) {
              setRefreshing(false)
              setHasMore(events.length > 0)
            }
          },
          onNew: (event) => {
            setNewEvents((oldEvents) =>
              [event, ...oldEvents].sort((a, b) => b.created_at - a.created_at)
            )
          }
        },
        {
          signer: async (evt) => {
            const signedEvt = await checkLogin(() => signEvent(evt))
            return signedEvt ?? null
          },
          needSort: !areAlgoRelays
        }
      )
      setTimelineKey(timelineKey)
      return closer
    }

    const promise = init()
    return () => {
      promise.then((closer) => closer())
    }
  }, [
    JSON.stringify(relayUrls),
    JSON.stringify(noteFilter),
    isFetchingRelayInfo,
    areAlgoRelays,
    refreshCount
  ])

  useEffect(() => {
    if (refreshing) return

    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore()
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [refreshing, hasMore, events, timelineKey])

  const loadMore = async () => {
    if (!timelineKey || refreshing) return

    const newEvents = await client.loadMoreTimeline(
      timelineKey,
      events.length ? events[events.length - 1].created_at - 1 : dayjs().unix(),
      noteFilter.limit
    )
    if (newEvents.length === 0) {
      setHasMore(false)
      return
    }
    setEvents((oldEvents) => [...oldEvents, ...newEvents])
  }

  const showNewEvents = () => {
    setEvents((oldEvents) => [...newEvents, ...oldEvents])
    setNewEvents([])
  }

  return (
    <div className={cn('space-y-2 sm:space-y-2', className)}>
      <ListModeSwitch listMode={listMode} setListMode={setListMode} />
      <PullToRefresh
        onRefresh={async () => {
          setRefreshCount((count) => count + 1)
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }}
        pullingContent=""
      >
        <div className="space-y-2 sm:space-y-2">
          {newEvents.filter((event) => listMode !== 'posts' || !isReplyNoteEvent(event)).length >
            0 && (
            <div className="flex justify-center w-full max-sm:mt-2">
              <Button size="lg" onClick={showNewEvents}>
                {t('show new notes')}
              </Button>
            </div>
          )}
          {isPictures ? (
            <SimpleMasonryGrid
              className="px-2 sm:px-4"
              columnCount={isSmallScreen ? 2 : 3}
              items={events.map((event) => (
                <PictureNoteCard key={event.id} className="w-full" event={event} />
              ))}
            />
          ) : (
            <div>
              {events
                .filter((event) => listMode === 'postsAndReplies' || !isReplyNoteEvent(event))
                .map((event) => (
                  <NoteCard key={event.id} className="w-full" event={event} />
                ))}
            </div>
          )}
          <div className="text-center text-sm text-muted-foreground">
            {hasMore || refreshing ? (
              <div ref={bottomRef}>{t('loading...')}</div>
            ) : events.length ? (
              t('no more notes')
            ) : (
              <div className="flex justify-center w-full max-sm:mt-2">
                <Button size="lg" onClick={() => setRefreshCount((pre) => pre + 1)}>
                  {t('reload notes')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </PullToRefresh>
    </div>
  )
}

function ListModeSwitch({
  listMode,
  setListMode
}: {
  listMode: TListMode
  setListMode: (listMode: TListMode) => void
}) {
  const { t } = useTranslation()

  return (
    <div>
      <div className="flex">
        <div
          className={`w-1/3 text-center py-2 font-semibold clickable cursor-pointer rounded-lg ${listMode === 'posts' ? '' : 'text-muted-foreground'}`}
          onClick={() => setListMode('posts')}
        >
          {t('Notes')}
        </div>
        <div
          className={`w-1/3 text-center py-2 font-semibold clickable cursor-pointer rounded-lg ${listMode === 'postsAndReplies' ? '' : 'text-muted-foreground'}`}
          onClick={() => setListMode('postsAndReplies')}
        >
          {t('Notes & Replies')}
        </div>
        <div
          className={`w-1/3 text-center py-2 font-semibold clickable cursor-pointer rounded-lg ${listMode === 'pictures' ? '' : 'text-muted-foreground'}`}
          onClick={() => setListMode('pictures')}
        >
          {t('Pictures')}
        </div>
      </div>
      <div
        className={`w-1/3 px-4 sm:px-6 transition-transform duration-500 ${listMode === 'postsAndReplies' ? 'translate-x-full' : listMode === 'pictures' ? 'translate-x-[200%]' : ''} `}
      >
        <div className="w-full h-1 bg-primary rounded-full" />
      </div>
    </div>
  )
}
