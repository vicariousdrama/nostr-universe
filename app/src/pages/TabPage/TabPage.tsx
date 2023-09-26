import { forwardRef, useEffect } from 'react'
import Slide from '@mui/material/Slide'
import { TransitionProps } from '@mui/material/transitions'
import { MODAL_PARAMS_KEYS } from '@/types/modal'
import { useOpenModalSearchParams } from '@/hooks/modal'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useOpenApp } from '@/hooks/open-entity'
import { TabMenu } from '@/components/TabMenu/TabMenu'
import { StyledDialog, StyledViewName, StyledWrap } from './styled'
import { useAppSelector } from '@/store/hooks/redux'
import { AppIcon } from '@/shared/AppIcon/AppIcon'
// import { Header } from '@/components/Header/Header' StyledAppBar

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement
  },
  ref: React.Ref<unknown>
) {
  return <Slide direction="left" ref={ref} {...props} />
})

export const TabPage = () => {
  const { openTabWindow, onHideTabInBrowser } = useOpenApp()
  const [searchParams] = useSearchParams()
  const { getModalOpened } = useOpenModalSearchParams()
  const navigate = useNavigate()
  const { workspaces } = useAppSelector((state) => state.workspaces)
  const { currentPubKey } = useAppSelector((state) => state.keys)
  const currentWorkSpace = workspaces.find((workspace) => workspace.pubkey === currentPubKey)
  const { openedTabs } = useAppSelector((state) => state.tab)
  const isOpen = getModalOpened(MODAL_PARAMS_KEYS.TAB_MODAL)
  const id = searchParams.get('tabId')
  const tab = currentWorkSpace?.tabs.find((tab) => tab.id === id)
  const tabState = openedTabs.find((tab) => tab.id === id)

  useEffect(() => {
    if (isOpen && id && !tab) navigate('/', { replace: true })
  }, [isOpen, id, tab])

  useEffect(() => {
    if (id && isOpen) {
      openTabWindow(id)
      return () => {
        onHideTabInBrowser(id)
      }
    }
  }, [id, isOpen])

  return (
    <StyledDialog
      // TransitionProps={{ onEntered: handleOpen }}
      fullScreen
      open={isOpen}
      TransitionComponent={Transition}
    >
      <StyledWrap>
        <AppIcon size="medium" picture={tabState?.picture || tab?.icon} isOutline={false} alt={tab?.title} />
        <StyledViewName>{tab?.title}</StyledViewName>
        {tabState?.loading && <StyledViewName variant="body2">Loading...</StyledViewName>}
      </StyledWrap>

      <TabMenu />
    </StyledDialog>
  )
}
