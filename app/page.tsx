import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, Edit3, Sparkles, Zap } from "lucide-react"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 font-bold">
            <Edit3 className="h-5 w-5 text-primary" />
            <span>WriteCraft AI</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Log in
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Sign up</Button>
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <section className="container space-y-6 py-24 md:py-32">
          <div className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Elevate Your Writing with{" "}
              <span className="bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                AI-Powered Insights
              </span>
            </h1>
            <p className="max-w-[42rem] text-muted-foreground sm:text-xl">
              Real-time feedback on clarity, tone, and persuasion. Write with confidence and
              impact.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link href="/signup">
                <Button size="lg" className="gap-2">
                  Get Started <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
        <section className="container py-12 md:py-24">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="flex flex-col items-center space-y-2 rounded-lg border p-6 text-center">
              <div className="rounded-full bg-primary/10 p-3">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold">Smart Suggestions</h3>
              <p className="text-muted-foreground">
                Get contextual recommendations to improve clarity, tone, and persuasion.
              </p>
            </div>
            <div className="flex flex-col items-center space-y-2 rounded-lg border p-6 text-center">
              <div className="rounded-full bg-primary/10 p-3">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold">Real-Time Feedback</h3>
              <p className="text-muted-foreground">
                See suggestions as you type with inline highlights and detailed explanations to improve your writing.
              </p>
            </div>
            <div className="flex flex-col items-center space-y-2 rounded-lg border p-6 text-center">
              <div className="rounded-full bg-primary/10 p-3">
                <Edit3 className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold">Brand Alignment</h3>
              <p className="text-muted-foreground">
                Customize tone preferences and writing goals to match your brand&apos;s voice and marketing objectives.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t py-6">
        <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} WriteCraft AI. All rights reserved.
          </p>
          <div className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/contact" className="hover:underline">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
