import { Swiper, SwiperSlide } from 'swiper/react'
import { FreeMode } from 'swiper/modules'

import 'swiper/css'
import styles from './slider.module.scss'
import { ISliderLiveEvents } from './types'
import { ItemLiveEvent } from '@/components/ItemsContent/ItemLiveEvent/ItemLiveEvent'
import { SkeletonLiveEvents } from '@/components/Skeleton/SkeletonLiveEvents/SkeletonLiveEvents'

export const SliderLiveEvents = ({ data, isLoading, handleClickEntity = () => {} }: ISliderLiveEvents) => {
  const renderContent = () => {
    if (isLoading) {
      return <SkeletonLiveEvents />
    }
    if (!data || !data.length) {
      return 'Nothing here'
    }
    return data.map((event, i) => (
      <SwiperSlide className={styles.slide} key={i} onClick={() => handleClickEntity(event)}>
        <ItemLiveEvent
          key={event.id}
          time={event.starts || event.created_at}
          hostPubkey={event.host}
          host={event.hostMeta}
          subtitle={event.title}
          content={event.summary || event.content.substring(0, 300)}
          status={event.status}
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
