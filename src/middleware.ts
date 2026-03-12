import { auth } from "@/auth"

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isOnLoginPage = req.nextUrl.pathname.startsWith('/login')

  if (isOnLoginPage) {
    if (isLoggedIn) {
      return Response.redirect(new URL('/', req.nextUrl))
    }
    return null
  }

  if (!isLoggedIn) {
    return Response.redirect(new URL('/login', req.nextUrl))
  }
})

// Configuration matcher per intercettare tutte le rotte tranne i file statici, immagini e API
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
