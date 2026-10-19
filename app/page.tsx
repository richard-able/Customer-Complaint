import React from 'react'

import Main from '@/app/components'

export const dynamic = 'force-dynamic'

const App = () => {
  return (
    <Main />
  )
}

export default React.memo(App)
