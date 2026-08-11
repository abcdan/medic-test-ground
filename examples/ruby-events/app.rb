require "json"
require "sinatra"

EVENTS = [
  { id: 1, name: "Ruby Meetup", starts_on: "2026-09-12" },
  { id: 2, name: "API Workshop", starts_on: "2026-10-03" },
  { id: 3, name: "Winter Social", starts_on: "2027-01-16" }
].freeze

get "/events/upcoming" do
  content_type :json
  today = Date.today

  EVENTS
    .select { |event| Date.iso8601(event[:starts_on]) >= today }
    .sort_by { |event| event[:starts_on] }
    .to_json
end
