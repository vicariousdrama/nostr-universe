import { TrendingProfiles } from './components/TrendingProfiles/TrendingProfiles'
import { AppsNostro } from './components/AppsNostro/AppsNostro'
import { ModalSelectApp } from '@/components/Modal/ModalSelectApp/ModalSelectApp'
import { Highlights } from './components/Highlights/Highlights'
import { TrendingNotes } from './components/TrendingNotes/TrendingNotes'
import { BigZaps } from './components/BigZaps/BigZaps'
import { LongPosts } from './components/LongPosts/LongPosts'
import { LiveEvents } from './components/LiveEvents/LiveEvents'
import { Communities } from './components/Communities/Communities'
import { StyledWrapperMain } from './styled'
import { SuggestedProfiles } from './components/SuggestedProfiles/SuggestedProfiles'
import { ModalSearch } from '@/components/Modal/ModalSearch/ModaSearch'
import { ProfilePage } from '@/pages/ProfilePage/ProfilePage'
import { ModaTabMenu } from '@/components/Modal/ModaTabMenu/ModaTabMenu'
import { TabPage } from '../TabPage/TabPage'
import { ModaContextMenu } from '@/components/Modal/ModaContextMenu/ModaContextMenu'
import { ModalPermissionsRequest } from '@/components/Modal/ModalPermissionsRequest/ModalPermissionsRequest'
import { ModaTabSwitcher } from '@/components/Modal/ModaTabSwitcher/ModaTabSwitcher'
import { ModaWallet } from '@/components/Modal/ModaWallet/ModaWallet'
import { TabsSwitcherPage } from '../TabsSwitcherPage/TabsSwitcherPage'
import { NavigationBottom } from '@/components/NavigationBottom/NavigationBottom'
import { Header } from '@/components/Header/Header'
import { AppsPage } from '../AppsPage/AppsPage'

export const MainPage = () => {
  return (
    <StyledWrapperMain>
      <Header />
      <TrendingNotes />
      <TrendingProfiles />
      <Highlights />
      <BigZaps />
      <LongPosts />
      <LiveEvents />
      <Communities />
      <SuggestedProfiles />

      <AppsNostro />

      {/* Modal pages */}
      <ProfilePage />
      <ModaTabSwitcher />
      <ModaTabMenu />
      <ModaWallet />
      <ModalSearch />
      <ModalSelectApp />
      <ModalPermissionsRequest />
      <TabPage />
      <ModaContextMenu />
      <TabsSwitcherPage />
      <AppsPage />

      <NavigationBottom />
    </StyledWrapperMain>
  )
}
