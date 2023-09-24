import { useOpenModalSearchParams } from '@/hooks/modal'
import { MODAL_PARAMS_KEYS } from '@/types/modal'
import { Modal } from '@/modules/Modal/Modal'
import { useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Button } from '@mui/material'
import { useOpenApp } from '@/hooks/open-entity'
import { AppIcon } from '@/shared/AppIcon/AppIcon'
import { useAppSelector } from '@/store/hooks/redux'
import { StyledButtonContainer, StyledFormControl, StyledInfo, StyledTitle, SwitchControl } from './styled'
import { Container } from '@/layout/Container/Conatiner'

export const ModalPermissionsRequest = () => {
  const { replyCurrentPermRequest } = useOpenApp()
  const [isRemember, setIsRemember] = useState(false)
  const [lastPermRequestId, setLastPermRequestId] = useState('')
  const [searchParams] = useSearchParams()
  const { handleClose, getModalOpened } = useOpenModalSearchParams()

  const isOpen = getModalOpened(MODAL_PARAMS_KEYS.PERMISSIONS_REQ)
  const currentPermId = searchParams.get('id') || ''
  const { permissionRequests } = useAppSelector((state) => state.permissionRequests)
  const { currentWorkSpace } = useAppSelector((state) => state.workspaces)

  const permReq = permissionRequests.find((permReq) => permReq.id === currentPermId)
  const getTab = currentWorkSpace.tabs.find((tab) => tab.id === permReq?.tabId)

  // reset flag for new input
  useEffect(() => {
    setIsRemember(false)
  }, [currentPermId, isOpen])

  // remember last request so that if user presses the system 'Back'
  // button we could react to it and execute disallow reply below
  useEffect(() => {
    if (currentPermId) setLastPermRequestId(currentPermId)
  }, [currentPermId])

  // disallow last request if it wasn't processed and the modal is closed
  useEffect(() => {
    if (!isOpen && lastPermRequestId) reply(false, false, lastPermRequestId)
  }, [isOpen])

  const reply = async (allow: boolean, remember: boolean, reqId: string) => {
    console.log('reply perm req ', reqId, 'allow', allow, 'remember', remember)

    // mark last req as done, so that form closure wouldn't disallow it
    setLastPermRequestId('')
    await replyCurrentPermRequest(allow, remember, reqId)
  }

  const handleCloseModal = async () => {
    handleClose()
  }

  // note: close the modal immediately and only after that
  // execute the reply in background, this way if reply takes
  // a lot of time user won't be able to click 'Back' and
  // won't repeat the 'close' logic
  const onDisallow = async () => {
    handleClose()
    await reply(false, isRemember, currentPermId)
  }

  const onAllow = async () => {
    handleClose()
    await reply(true, isRemember, currentPermId)
  }

  const prepareLabelAndPayload = () => {
    if (!permReq) {
      return {
        label: '',
        payload: ''
      }
    }

    const { perm, event = {}, paymentRequest = '', wallet = {}, amount = 0, plainText, cipherText } = permReq || {}

    let label = ''
    let payload = null
    if (perm === 'pubkey') {
      label = 'Read your public key'
    } else if (perm?.startsWith('pay_invoice:')) {
      label = `Payment from wallet '${wallet.name}' amount ${amount / 1000} sats:`
      payload = paymentRequest
    } else if (perm?.startsWith('sign:')) {
      const kind = perm?.split(':')[1]
      label = 'Sign event of kind ' + kind + ':'
      payload = JSON.stringify(event, null, 2)
    } else if (perm === 'encrypt') {
      label = 'Encrypt a message:'
      // FIXME add pubkey
      payload = plainText
    } else if (perm === 'decrypt') {
      label = 'Decrypt a message:'
      // FIXME add pubkey
      payload = cipherText
    }
    return { label, payload }
  }

  const { label, payload } = prepareLabelAndPayload()

  return (
    <Modal title="Permission request" open={isOpen} handleClose={handleCloseModal}>
      <Container>
        <StyledInfo>
          <AppIcon size="large" picture={getTab?.icon} alt={getTab?.title} isOutline={false} />
          <StyledTitle variant="h6">{getTab?.title}</StyledTitle>
        </StyledInfo>

        <StyledTitle variant="body1">{label}</StyledTitle>
        {payload && <StyledTitle variant="body2">{payload}</StyledTitle>}
        <StyledFormControl
          control={<SwitchControl checked={isRemember} onChange={(e) => setIsRemember(e.target.checked)} />}
          label="Remember, don't ask again"
        />

        <StyledButtonContainer>
          <Button fullWidth variant="contained" className="button" color="secondary" onClick={onDisallow}>
            Disallow
          </Button>
          <Button fullWidth variant="contained" className="button" color="secondary" onClick={onAllow}>
            Allow
          </Button>
        </StyledButtonContainer>
      </Container>
    </Modal>
  )
}
