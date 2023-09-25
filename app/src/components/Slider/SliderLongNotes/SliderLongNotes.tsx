import { Swiper, SwiperSlide } from 'swiper/react'
import { FreeMode } from 'swiper/modules'
import { ISliderLongNotes } from './types'
import 'swiper/css'
import styles from './slider.module.scss'
import { ItemLongNote } from '../../ItemsContent/ItemLongNote/ItemLongNote'
import { SkeletonLongPosts } from '@/components/Skeleton/SkeletonLongPosts/SkeletonLongPosts'

export const SliderLongNotes = ({ data, isLoading, handleClickEntity = () => {} }: ISliderLongNotes) => {
  const renderContent = () => {
    if (isLoading) {
      return <SkeletonLongPosts />
    }
    if (!data) {
      return 'Nothing here'
    }
    return data.map((longPost, i) => (
      <SwiperSlide className={styles.slide} key={i} onClick={() => handleClickEntity(longPost)}>
        <ItemLongNote
          time={longPost.created_at}
          content={longPost.content}
          subtitle={longPost.title}
          pubkey={longPost.pubkey}
          author={longPost.author}
        />
      </SwiperSlide>
    ))
  }
  return (
    <Swiper slidesPerView="auto" freeMode={true} modules={[FreeMode]}>
      {renderContent()}
    </Swiper>
  )
}
