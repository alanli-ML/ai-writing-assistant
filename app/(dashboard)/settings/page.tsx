"use client"

import { useEffect, useState } from "react"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Loader2, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/components/ui/use-toast"
import { DashboardLayout } from "@/components/dashboard-layout"
import { useAuth } from "@/components/auth-provider"
import { db } from "@/components/auth-provider"

const formSchema = z.object({
  displayName: z.string().min(2, {
    message: "Display name must be at least 2 characters.",
  }),
  preferredTone: z.enum(["professional", "casual", "persuasive", "informative"]),
  writingGoals: z.array(z.string()).min(1, {
    message: "Select at least one writing goal.",
  }),
  feedbackOptIn: z.boolean(),
})

const writingGoalOptions = [
  { id: "clarity", label: "Improve clarity" },
  { id: "persuasion", label: "Enhance persuasion" },
  { id: "grammar", label: "Fix grammar issues" },
  { id: "tone", label: "Adjust tone" },
  { id: "brevity", label: "Increase brevity" },
  { id: "consistency", label: "Enhance consistency" },
]

export default function SettingsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: "",
      preferredTone: "professional",
      writingGoals: ["clarity", "persuasion", "grammar", "tone", "brevity", "consistency"],
      feedbackOptIn: true,
    },
  })

  useEffect(() => {
    async function fetchUserSettings() {
      if (!user) return

      try {
        const userDocRef = doc(db, "users", user.uid)
        const userDoc = await getDoc(userDocRef)

        if (userDoc.exists()) {
          const data = userDoc.data()
          form.reset({
            displayName: data.displayName || user.displayName || "",
            preferredTone: data.preferredTone || "professional",
            writingGoals: data.writingGoals || ["clarity", "persuasion", "grammar", "tone", "brevity", "consistency"],
            feedbackOptIn: data.feedbackOptIn !== false,
          })
        } else {
          // Initialize with defaults if no settings exist
          form.reset({
            displayName: user.displayName || "",
            preferredTone: "professional",
            writingGoals: ["clarity", "persuasion", "grammar", "tone", "brevity", "consistency"],
            feedbackOptIn: true,
          })
        }
      } catch (error) {
        console.error("Error fetching user settings:", error)
        toast({
          variant: "destructive",
          title: "Failed to load settings",
          description: "Please try again later.",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchUserSettings()
  }, [user, form, toast])

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user) return

    setSaving(true)
    try {
      const userDocRef = doc(db, "users", user.uid)
      await setDoc(userDocRef, values, { merge: true })

      toast({
        title: "Settings saved",
        description: "Your preferences have been updated successfully.",
      })
    } catch (error) {
      console.error("Error saving settings:", error)
      toast({
        variant: "destructive",
        title: "Failed to save settings",
        description: "Please try again later.",
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-[500px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-3xl font-bold">Settings</h1>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Your name" {...field} />
                  </FormControl>
                  <FormDescription>This is the name that will be used throughout the application.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preferredTone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preferred Writing Tone</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a tone" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="casual">Casual</SelectItem>
                      <SelectItem value="persuasive">Persuasive</SelectItem>
                      <SelectItem value="informative">Informative</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>This tone will be used as the default for AI suggestions.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="writingGoals"
              render={() => (
                <FormItem>
                  <div className="mb-4">
                    <FormLabel>Writing Goals</FormLabel>
                    <FormDescription>
                      Select the areas you want the AI to focus on when providing suggestions.
                    </FormDescription>
                  </div>
                  {writingGoalOptions.map((option) => (
                    <FormField
                      key={option.id}
                      control={form.control}
                      name="writingGoals"
                      render={({ field }) => {
                        return (
                          <FormItem key={option.id} className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(option.id)}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...field.value, option.id])
                                    : field.onChange(field.value?.filter((value) => value !== option.id))
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal">{option.label}</FormLabel>
                          </FormItem>
                        )
                      }}
                    />
                  ))}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="feedbackOptIn"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Opt-in to feedback collection</FormLabel>
                    <FormDescription>
                      Allow us to collect anonymous data on which suggestions you accept to improve our AI.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Settings
            </Button>
          </form>
        </Form>
      </div>
    </DashboardLayout>
  )
}
