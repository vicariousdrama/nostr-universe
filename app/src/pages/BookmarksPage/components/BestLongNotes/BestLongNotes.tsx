import { HorizontalSwipeContent } from '@/shared/HorizontalSwipeContent/HorizontalSwipeContent'
import { StyledTitle, StyledWrapper } from './styled'
import { Container } from '@/layout/Container/Conatiner'
import { SkeletonLongPosts } from '@/components/Skeleton/SkeletonLongPosts/SkeletonLongPosts'
import { EmptyListMessage } from '@/shared/EmptyListMessage/EmptyListMessage'
import { CSSProperties, FC, useCallback } from 'react'
import { LongNoteEvent } from '@/types/long-note-event'
import {
  HorizontalSwipeVirtualContent,
  HorizontalSwipeVirtualItem
} from '@/shared/HorizontalSwipeVirtualContent/HorizontalSwipeVirtualContent'
import { BestLongNoteItem } from './BestLongNoteItem/BestLongNoteItem'
import { useAppDispatch, useAppSelector } from '@/store/hooks/redux'
import { fetchBestLongNotesThunk } from '@/store/reducers/bookmarks.slice'

export const BestLongNotes = () => {
  const { bestLongNotes, isBestLongNotesLoading } = useAppSelector((state) => state.bookmarks)
  const { currentPubkey } = useAppSelector((state) => state.keys)
  const dispatch = useAppDispatch()

  const reloadBestNotes = useCallback(() => {
    dispatch(fetchBestLongNotesThunk(currentPubkey))
  }, [currentPubkey, dispatch])

  const renderContent = useCallback(() => {
    if (isBestLongNotesLoading) {
      return (
        <HorizontalSwipeContent childrenWidth={225}>
          <SkeletonLongPosts />
        </HorizontalSwipeContent>
      )
    }
    if (!bestLongNotes.length && !isBestLongNotesLoading) {
      return <EmptyListMessage onReload={reloadBestNotes} />
    }

    const Row: FC<{ index: number; style: CSSProperties }> = ({ index, style }) => {
      const longNote = bestLongNotes[index]
      const longNoteTargetEvent = longNote.targetEvent as LongNoteEvent
      return (
        <HorizontalSwipeVirtualItem style={style} index={index} itemCount={bestLongNotes.length}>
          <BestLongNoteItem
            pubkey={longNoteTargetEvent.pubkey}
            author={longNoteTargetEvent.author}
            content={longNoteTargetEvent.content}
            reactionKind={longNote.kind}
            reactionTime={longNote.created_at}
          />
        </HorizontalSwipeVirtualItem>
      )
    }

    return (
      <HorizontalSwipeVirtualContent
        itemHight={121}
        itemSize={225}
        itemCount={bestLongNotes.length}
        RowComponent={Row}
      />
    )
  }, [bestLongNotes, isBestLongNotesLoading, reloadBestNotes])

  return (
    <StyledWrapper>
      <Container>
        <StyledTitle variant="h5" gutterBottom component="div">
          Best Long Notes
        </StyledTitle>
      </Container>
      {renderContent()}
    </StyledWrapper>
  )
}